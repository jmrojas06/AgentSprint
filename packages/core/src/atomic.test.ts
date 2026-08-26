import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '../src/index.js'
import { withFileLock } from '../src/filelock.js'

// Multi-process tests run against the built bundle (children cannot import TS
// directly); they are skipped when core has not been built yet.
const distPath = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const hasDist = fs.existsSync(distPath)

// Args are taken from the tail so the script works regardless of how `node -e`
// indexes process.argv.
const CHILD_SCRIPT = `
const [distPath, boardDir, count, label] = process.argv.slice(-4)
import(distPath).then(({ ProjectStore }) => {
  const store = ProjectStore.open(boardDir)
  const n = Number(count)
  for (let i = 0; i < n; i++) {
    store.appendLearning('entry-' + label + '-' + i)
    store.appendTaskNote('TK-1', 'note-' + label + '-' + i, label)
  }
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1) },
)
`

const CHILD_SECTION_SCRIPT = `
const [distPath, boardDir, count, label] = process.argv.slice(-4)
import(distPath).then(({ ProjectStore }) => {
  const store = ProjectStore.open(boardDir)
  const n = Number(count)
  for (let i = 0; i < n; i++) {
    store.appendLearningsSection('Section-' + label + '-' + i, 'body-' + label + '-' + i)
    store.updateTask('TK-1', { description: 'desc-' + label + '-' + i }, { actor: label })
  }
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1) },
)
`

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-atomic-'))
  store = ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const artifactsUnderBoard = (): string[] =>
  fs
    .readdirSync(path.join(dir, '.agentboard'), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'))

describe('safe atomic persistence', () => {
  it('uses unique temp names and leaves no .tmp/.lock residue after normal operations', () => {
    store.appendLearning('first')
    store.appendLearningsSection('Header', 'body')
    store.setTaskStatus('TK-1', 'Review')
    store.appendTaskNote('TK-1', 'a note', 'dev')

    expect(store.getLearnings()).toContain('- first')
    expect(artifactsUnderBoard()).toEqual([])
  })

  it('removes the temp file when the atomic write fails', () => {
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('rename failed')
    })
    try {
      expect(() => store.setLearnings('boom')).toThrow('rename failed')
    } finally {
      renameSpy.mockRestore()
    }
    expect(artifactsUnderBoard()).toEqual([])
    // The previous content must survive a failed overwrite.
    expect(store.getLearnings()).not.toContain('boom')
  })

  it('serializes writers through the per-file lock', () => {
    const learningsPath = path.join(dir, '.agentboard', 'learnings.md')
    fs.writeFileSync(`${learningsPath}.lock`, '')

    // A held foreign lock makes acquisition time out instead of corrupting state.
    expect(() => withFileLock(learningsPath, () => {}, { timeoutMs: 60 })).toThrow(/Timed out/)
    expect(fs.existsSync(`${learningsPath}.lock`)).toBe(true)

    // After release, acquisition succeeds and the sidecar is cleaned up.
    fs.unlinkSync(`${learningsPath}.lock`)
    expect(withFileLock(learningsPath, () => 'ran', { timeoutMs: 500 })).toBe('ran')
    expect(fs.existsSync(`${learningsPath}.lock`)).toBe(false)

    // Store operations also clean up their lock.
    store.appendLearning('after-lock')
    expect(artifactsUnderBoard()).toEqual([])
  })

  it.runIf(hasDist)(
    'loses no entries when two processes append to learnings and task notes concurrently',
    async () => {
      const count = 30
      const children = ['a', 'b'].map((label) => {
        const child = spawn(process.execPath, ['-e', CHILD_SCRIPT, distPath, dir, String(count), label], {
          stdio: ['ignore', 'ignore', 'inherit'],
        })
        return new Promise<void>((resolve, reject) => {
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child ${label} exited with ${code}`))))
          child.on('error', reject)
        })
      })

      await Promise.all(children)

      const reopened = ProjectStore.open(dir)
      const learnings = reopened.getLearnings()
      const notes = reopened.state.tasks.find((t) => t.id === 'TK-1')?.notes ?? ''
      for (let i = 0; i < count; i++) {
        expect(learnings).toContain(`entry-a-${i}`)
        expect(learnings).toContain(`entry-b-${i}`)
        expect(notes).toContain(`note-a-${i}`)
        expect(notes).toContain(`note-b-${i}`)
      }

      // No leftover temp or lock files after concurrent writes.
      expect(artifactsUnderBoard()).toEqual([])
    },
    30_000,
  )

  it.runIf(hasDist)(
    'loses no entries when two processes append sections and update tasks concurrently',
    async () => {
      const count = 20
      const children = ['a', 'b'].map((label) => {
        const child = spawn(process.execPath, ['-e', CHILD_SECTION_SCRIPT, distPath, dir, String(count), label], {
          stdio: ['ignore', 'ignore', 'inherit'],
        })
        return new Promise<void>((resolve, reject) => {
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child ${label} exited with ${code}`))))
          child.on('error', reject)
        })
      })

      await Promise.all(children)

      const reopened = ProjectStore.open(dir)
      const learnings = reopened.getLearnings()
      for (let i = 0; i < count; i++) {
        expect(learnings).toContain(`Section-a-${i}`)
        expect(learnings).toContain(`Section-b-${i}`)
        expect(learnings).toContain(`body-a-${i}`)
        expect(learnings).toContain(`body-b-${i}`)
      }
      // updateTask writes are serialized: the file must be valid and contain
      // activity events from both writers (no lost writes to the activity log).
      const task = reopened.state.tasks.find((t) => t.id === 'TK-1')!
      expect(task).toBeDefined()
      // each child did `count` updates, plus the initial create event
      expect(task.activity.length).toBeGreaterThanOrEqual(count * 2)
      expect(task.activity.some((a) => a.actor === 'a')).toBe(true)
      expect(task.activity.some((a) => a.actor === 'b')).toBe(true)

      expect(artifactsUnderBoard()).toEqual([])
    },
    30_000,
  )
})

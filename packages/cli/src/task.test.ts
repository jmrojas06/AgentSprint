import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { cmdTask, parseArgs } from './index.js'

let dir: string
let store: ProjectStore
let id: string
let out: string[]
let err: string[]

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-task-'))
  store = ProjectStore.init(dir, { sample: true })
  id = store.createTask({ title: 'CLI target', acceptanceCriteria: ['first criterion', 'second criterion'] }).id
  out = []
  err = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
  vi.spyOn(process.stdout, 'write').mockImplementation(((s: string) => (out.push(String(s)), true)) as never)
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

const fresh = () => ProjectStore.open(dir).state.tasks.find((t) => t.id === id)!
const lastEvent = () => fresh().activity.at(-1)!

describe('parseArgs: task subcommands', () => {
  it('parses claim with --agent and --force', () => {
    const args = parseArgs(['task', 'claim', dir, 'TK-9', '--agent', 'developer', '--force'])
    expect(args).toMatchObject({ command: 'task-cmd', dir: path.resolve(dir), taskCmd: { action: 'claim', id: 'TK-9', agent: 'developer', force: true } })
  })

  it('parses review with a verdict, repeatable findings and a summary', () => {
    const args = parseArgs(['task', 'review', dir, 'TK-9', '--agent', 'code-reviewer', '--verdict', 'changes', '--finding', 'a', '--finding', 'b', '--summary', 's'])
    expect(args?.taskCmd).toMatchObject({ action: 'review', verdict: 'changes', findings: ['a', 'b'], summary: 's', agent: 'code-reviewer' })
  })

  it('parses status, note, check and show', () => {
    expect(parseArgs(['task', 'status', dir, 'TK-9', 'Review'])?.taskCmd).toMatchObject({ action: 'status', status: 'Review' })
    expect(parseArgs(['task', 'note', dir, 'TK-9', 'did it'])?.taskCmd).toMatchObject({ action: 'note', text: 'did it' })
    expect(parseArgs(['task', 'check', dir, 'TK-9', '0', '--uncheck'])?.taskCmd).toMatchObject({ action: 'check', text: '0', uncheck: true })
    expect(parseArgs(['task', 'show', dir, 'TK-9', '--json'])?.taskCmd).toMatchObject({ action: 'show', json: true })
  })

  it('rejects a bad status, a flag the subcommand does not take and missing arguments', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    expect(() => parseArgs(['task', 'status', dir, 'TK-9', 'Doing'])).toThrow('exit')
    expect(() => parseArgs(['task', 'note', dir, 'TK-9', 'x', '--force'])).toThrow('exit')
    expect(() => parseArgs(['task', 'claim', dir])).toThrow('exit')
    expect(() => parseArgs(['task', 'review', dir, 'TK-9', '--verdict', 'maybe'])).toThrow('exit')
    expect(() => parseArgs(['task', 'frobnicate', dir, 'TK-9'])).toThrow('exit')
    exit.mockRestore()
  })
})

describe('cmdTask', () => {
  it('claim takes the lock, moves to In Progress and assigns the claiming agent', () => {
    expect(cmdTask(dir, { action: 'claim', id, agent: 'developer' })).toBe(0)
    const task = fresh()
    expect(task.status).toBe('In Progress')
    expect(task.assignee).toBe('developer')
    expect(task.lockedBy).toBe('developer')
    expect(task.activity).toContainEqual(expect.objectContaining({ actor: 'developer', type: 'status', detail: 'To Do → In Progress' }))
  })

  it('claim is refused while another agent holds the lock, unless --force', () => {
    store.lockTask(id, 'designer')
    expect(cmdTask(dir, { action: 'claim', id, agent: 'developer' })).toBe(1)
    expect(err.join('\n')).toContain(`Task ${id} is locked by "designer"`)
    expect(fresh().status).toBe('To Do')
    expect(fresh().lockedBy).toBe('designer')

    expect(cmdTask(dir, { action: 'claim', id, agent: 'developer', force: true })).toBe(0)
    expect(fresh().lockedBy).toBe('developer')
  })

  it('claim is refused while dependencies are open, unless --force', () => {
    const dep = store.createTask({ title: 'dependency' }).id
    const blocked = store.createTask({ title: 'blocked', dependencies: [dep] }).id
    expect(cmdTask(dir, { action: 'claim', id: blocked, agent: 'developer' })).toBe(1)
    expect(err.join('\n')).toContain(`Task ${blocked} is blocked by ${dep}`)
    expect(cmdTask(dir, { action: 'claim', id: blocked, agent: 'developer', force: true })).toBe(0)
  })

  it('release frees your own lock and refuses a foreign one', () => {
    cmdTask(dir, { action: 'claim', id, agent: 'developer' })
    expect(cmdTask(dir, { action: 'release', id, agent: 'designer' })).toBe(1)
    expect(err.join('\n')).toContain('not by "designer"')
    expect(cmdTask(dir, { action: 'release', id, agent: 'developer' })).toBe(0)
    expect(fresh().lockedBy ?? null).toBeNull()
  })

  it('status records the --agent as the activity actor', () => {
    expect(cmdTask(dir, { action: 'status', id, status: 'Review', agent: 'developer' })).toBe(0)
    expect(fresh().status).toBe('Review')
    expect(fresh().activity).toContainEqual(expect.objectContaining({ actor: 'developer', type: 'status', detail: 'To Do → Review' }))
  })

  it('note appends a timestamped note by the agent, with a sanitized actor', () => {
    expect(cmdTask(dir, { action: 'note', id, text: 'picked the store API', agent: 'dev|eloper' })).toBe(0)
    expect(fresh().notes).toMatch(/^- \[\d{4}-\d\d-\d\dT[^\]]+\] \(dev\/eloper\) picked the store API$/m)
    expect(lastEvent()).toMatchObject({ actor: 'dev/eloper', type: 'note' })
  })

  it('check ticks a criterion by index or text, --uncheck clears it, and unknown ones fail', () => {
    expect(cmdTask(dir, { action: 'check', id, text: '1', agent: 'developer' })).toBe(0)
    expect(fresh().acceptanceCriteria).toEqual(['first criterion', '[x] second criterion'])
    expect(cmdTask(dir, { action: 'check', id, text: 'first', agent: 'developer' })).toBe(0)
    expect(fresh().acceptanceCriteria[0]).toBe('[x] first criterion')
    expect(lastEvent()).toMatchObject({ actor: 'developer', type: 'checklist' })
    expect(cmdTask(dir, { action: 'check', id, text: 'second', uncheck: true })).toBe(0)
    expect(fresh().acceptanceCriteria[1]).toBe('second criterion')
    expect(cmdTask(dir, { action: 'check', id, text: 'nope' })).toBe(1)
    expect(err.join('\n')).toContain(`Acceptance criterion not found for task ${id}`)
  })

  it('review approves, requests changes with findings, and needs a finding for changes', () => {
    store.setTaskStatus(id, 'Review')
    expect(cmdTask(dir, { action: 'review', id, agent: 'code-reviewer', verdict: 'changes', findings: [] })).toBe(1)
    expect(err.join('\n')).toContain('needs at least one finding')
    expect(cmdTask(dir, { action: 'review', id, agent: 'code-reviewer', verdict: 'changes', findings: ['index.ts:1 breaks'], summary: 'one bug' })).toBe(0)
    expect(fresh().status).toBe('In Progress')
    expect(fresh().notes).toContain('(code-reviewer) **Review: changes requested** — one bug')
    expect(lastEvent()).toMatchObject({ actor: 'code-reviewer', type: 'review' })
    store.setTaskStatus(id, 'Review')
    expect(cmdTask(dir, { action: 'review', id, agent: 'code-reviewer', verdict: 'approve' })).toBe(0)
    expect(fresh().status).toBe('Review')
  })

  it('show prints the task spec, or the task as JSON', () => {
    expect(cmdTask(dir, { action: 'show', id })).toBe(0)
    expect(out.join('')).toContain('## Acceptance criteria')
    expect(out.join('')).toContain('- [ ] first criterion')
    out.length = 0
    expect(cmdTask(dir, { action: 'show', id, json: true })).toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ id, title: 'CLI target', status: 'To Do' })
  })

  it('fails cleanly for an unknown task', () => {
    expect(cmdTask(dir, { action: 'note', id: 'TK-999', text: 'x' })).toBe(1)
    expect(cmdTask(dir, { action: 'show', id: 'TK-999' })).toBe(1)
    expect(err.join('\n')).toContain('TK-999')
  })

  it('treats an empty --agent as missing and refuses an empty note', () => {
    expect(cmdTask(dir, { action: 'claim', id, agent: '  ' })).toBe(0)
    expect(fresh().lockedBy).toBe('agent')
    expect(cmdTask(dir, { action: 'note', id, text: '   ', agent: 'agent' })).toBe(1)
    expect(fresh().notes).toBe('')
  })

  it('refuses ids that are not task ids (no path traversal)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    for (const bad of ['../../etc/passwd', 'TK-1/../TK-1', 'tk-1']) {
      expect(() => parseArgs(['task', 'show', dir, bad])).toThrow('exit')
    }
    exit.mockRestore()
  })
})

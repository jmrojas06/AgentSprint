import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findTaskBranches, findTaskCommits, findTaskRefs, taskCommitCounts, taskRefPattern } from '../src/index.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-gitlinks-'))
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test User')
  git('config', 'user.email', 'test@example.com')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function git(...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
}

function commit(message: string): void {
  fs.writeFileSync(path.join(dir, `file-${Math.random().toString(36).slice(2)}.txt`), message)
  execFileSync('git', ['-C', dir, 'add', '-A'])
  git('commit', '-m', message)
}

describe('taskRefPattern', () => {
  it('matches the id on word boundaries by default', () => {
    const re = taskRefPattern('TK-12')
    expect(re.test('feat: implement TK-12')).toBe(true)
    expect(re.test('fix TK-123 too')).toBe(false)
  })

  it('supports a custom pattern with %ID% placeholder', () => {
    const re = taskRefPattern('TK-12', '^feat/%ID%')
    expect(re.test('feat/TK-12 add stuff')).toBe(true)
    expect(re.test('fix: TK-12')).toBe(false)
  })
})

describe('findTaskCommits', () => {
  it('returns commits referencing the task id across all refs, newest first', async () => {
    commit('initial setup')
    commit('feat: implement TK-1 first half')
    commit('unrelated change')
    commit('board: TK-1 done; also mentions TK-2 in passing')

    const commits = await findTaskCommits(dir, 'TK-1')
    expect(commits).toHaveLength(2)
    expect(commits[0]!.message).toContain('done; also mentions TK-2')
    expect(commits[0]!.author).toBe('Test User')
    expect(commits[0]!.shortHash).toMatch(/^[0-9a-f]{7,}$/)
    expect(commits[0]!.date).toBeTruthy()
    expect(commits.map((c) => c.message)).not.toContain('unrelated change')

    const tk2 = await findTaskCommits(dir, 'TK-2')
    expect(tk2).toHaveLength(1)
    expect(tk2[0]!.message).toContain('also mentions TK-2')
  })

  it('does not match partial ids (TK-1 vs TK-12)', async () => {
    commit('work for TK-12 only')
    const tk1 = await findTaskCommits(dir, 'TK-1')
    expect(tk1).toHaveLength(0)
  })

  it('respects the max option and custom pattern', async () => {
    commit('feat/TK-5 alpha')
    commit('chore TK-5 beta')
    const limited = await findTaskCommits(dir, 'TK-5', { max: 1 })
    expect(limited).toHaveLength(1)
    const branchStyle = await findTaskCommits(dir, 'TK-5', { pattern: '^feat/%ID%' })
    expect(branchStyle).toHaveLength(1)
    expect(branchStyle[0]!.message).toBe('feat/TK-5 alpha')
  })

  it('returns empty list for a non-git directory', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-nogit-'))
    try {
      expect(await findTaskCommits(plain, 'TK-1')).toEqual([])
      expect(await findTaskRefs(plain, 'TK-1')).toEqual({ gitAvailable: false, commits: [], branches: [] })
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe('findTaskBranches', () => {
  it('lists branches whose name references the task id', async () => {
    commit('initial')
    git('switch', '-c', 'feat/TK-3')
    commit('branch work TK-3')

    const branches = await findTaskBranches(dir, 'TK-3')
    expect(branches).toContain('feat/TK-3')
    expect(findTaskRefs === undefined).toBe(false)

    const refs = await findTaskRefs(dir, 'TK-3')
    expect(refs.gitAvailable).toBe(true)
    expect(refs.branches).toContain('feat/TK-3')
    expect(refs.commits.length).toBeGreaterThan(0)
  })
})

describe('taskCommitCounts', () => {
  it('counts commits per known task id with a single scan', async () => {
    commit('setup')
    commit('AS-8 cycle detection')
    commit('AS-8 tests + AS-9 learnings storage')
    commit('random refactor')

    const counts = await taskCommitCounts(dir, ['AS-8', 'AS-9'])
    expect(counts['AS-8']).toBe(2)
    expect(counts['AS-9']).toBe(1)
  })

  it('ignores ids that are not in the known set', async () => {
    commit('mentions ZZ-99 which is not on the board')
    const counts = await taskCommitCounts(dir, ['TK-1'])
    expect(counts).toEqual({})
  })

  it('returns {} when there are no tasks or no repo', async () => {
    expect(await taskCommitCounts(dir, [])).toEqual({})
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-nogit2-'))
    try {
      expect(await taskCommitCounts(plain, ['TK-1'])).toEqual({})
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})

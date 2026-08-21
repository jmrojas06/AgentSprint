import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, getTaskLock } from '../src/index.js'

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-lock-'))
  store = ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('task locks', () => {
  it('starts unlocked', () => {
    expect(store.getLock('TK-1')).toBeNull()
    expect(getTaskLock(store.state.tasks[0]!)).toBeNull()
  })

  it('acquires a lock and persists it in frontmatter', () => {
    store.lockTask('TK-1', 'agent-a')
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    expect(task.lockedBy).toBe('agent-a')
    expect(task.lockedAt).toBeTruthy()
    // Re-open from disk: the lock survives persistence
    const reopened = ProjectStore.open(dir)
    expect(reopened.getLock('TK-1')?.lockedBy).toBe('agent-a')
  })

  it('rejects a second agent while locked (only one claim wins)', () => {
    store.lockTask('TK-1', 'agent-a')
    expect(() => store.lockTask('TK-1', 'agent-b')).toThrow(/locked by "agent-a"/)
    // Same agent re-claiming is a heartbeat, not an error
    const refreshed = store.lockTask('TK-1', 'agent-a')
    expect(refreshed.lockedBy).toBe('agent-a')
  })

  it('expires locks after the TTL so stale claims are freed', () => {
    store.lockTask('TK-1', 'agent-a')
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    // Simulate a heartbeat 31 minutes old
    const stale = new Date(Date.now() - 31 * 60_000).toISOString()
    store.updateTask('TK-1', { lockedAt: stale }, { actor: 'agent-a' })
    const now = new Date()
    expect(getTaskLock({ ...task, lockedAt: stale }, now)).toBeNull()
    expect(() => store.lockTask('TK-1', 'agent-b')).not.toThrow()
  })

  it('releases the lock and clears the fields on disk', () => {
    store.lockTask('TK-1', 'agent-a')
    const released = store.unlockTask('TK-1', { agent: 'agent-a' })
    expect(released.lockedBy == null || released.lockedBy === undefined).toBe(true)
    expect(released.lockedAt == null || released.lockedAt === undefined).toBe(true)
    const reopened = ProjectStore.open(dir)
    expect(reopened.getLock('TK-1')).toBeNull()
    expect(fs.readFileSync(path.join(dir, '.agentboard', 'tasks', 'TK-1.md'), 'utf8')).not.toContain('lockedBy')
  })

  it("refuses release by another agent unless forced", () => {
    store.lockTask('TK-1', 'agent-a')
    expect(() => store.unlockTask('TK-1', { agent: 'agent-b' })).toThrow(/not by "agent-b"/)
    expect(store.getLock('TK-1')?.lockedBy).toBe('agent-a')
    expect(store.unlockTask('TK-1', { agent: 'agent-b', force: true }).lockedBy == null).toBe(true)
  })

  it('unlock is a no-op on an unlocked task', () => {
    const task = store.unlockTask('TK-2')
    expect(task.id).toBe('TK-2')
  })
})

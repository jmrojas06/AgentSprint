import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, lintProject } from '../src/index.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-lint-'))
  ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('lintProject', () => {
  it('passes on a healthy board', () => {
    const result = lintProject(dir)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('reports when no board exists', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-lint-empty-'))
    try {
      const result = lintProject(empty)
      expect(result.ok).toBe(false)
      expect(result.issues[0]?.code).toBe('NO_BOARD')
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('reports duplicate task IDs', () => {
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    fs.writeFileSync(
      path.join(tasksDir, 'TK-10.md'),
      '---\nid: TK-1\ntitle: dup\nstatus: To Do\npriority: medium\nassignee: scrum-master\nsprint: 1\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nbody\n',
      'utf8',
    )
    const result = lintProject(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'DUPLICATE_ID')).toBe(true)
  })

  it('reports tasks referencing non-existent sprints', () => {
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    fs.writeFileSync(
      path.join(tasksDir, 'TK-90.md'),
      '---\nid: TK-90\ntitle: orphan sprint\nstatus: To Do\npriority: medium\nassignee: scrum-master\nsprint: 999\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nbody\n',
      'utf8',
    )
    const result = lintProject(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'INVALID_SPRINT_REF')).toBe(true)
  })

  it('reports tasks depending on non-existent tasks', () => {
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    fs.writeFileSync(
      path.join(tasksDir, 'TK-91.md'),
      '---\nid: TK-91\ntitle: bad dep\nstatus: To Do\npriority: medium\nassignee: scrum-master\nsprint: 1\ndependencies:\n  - TK-999\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nbody\n',
      'utf8',
    )
    const result = lintProject(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'INVALID_DEPENDENCY')).toBe(true)
  })

  it('reports invalid YAML frontmatter', () => {
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    fs.writeFileSync(
      path.join(tasksDir, 'AS-99.md'),
      '---\nid: AS-99\ntitle: Bad: YAML colon\nstatus: To Do\n---\n\nbody\n',
      'utf8',
    )
    const result = lintProject(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'INVALID_FRONTMATTER')).toBe(true)
  })
})

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

  it('accepts relative files and globs, rejects absolute paths and ".."', () => {
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    const task = (id: string, files: string) =>
      `---\nid: ${id}\ntitle: files\nstatus: Done\npriority: medium\nassignee: scrum-master\nsprint: 1\nfiles: ${files}\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nbody\n`
    fs.writeFileSync(path.join(tasksDir, 'TK-80.md'), task('TK-80', '["packages/web/**", "docs/agents.md"]'), 'utf8')
    expect(lintProject(dir).issues).toEqual([])
    fs.writeFileSync(path.join(tasksDir, 'TK-81.md'), task('TK-81', '["/etc/passwd", "../other/x.ts", "packages/../../x", ""]'), 'utf8')
    const result = lintProject(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.filter((i) => i.code === 'INVALID_FILES').map((i) => i.message)).toEqual([
      `Task 'TK-81' files entry "/etc/passwd" must be a repo-relative path or glob without ".."`,
      `Task 'TK-81' files entry "../other/x.ts" must be a repo-relative path or glob without ".."`,
      `Task 'TK-81' files entry "packages/../../x" must be a repo-relative path or glob without ".."`,
      `Task 'TK-81' files entry "" must be a repo-relative path or glob without ".."`,
    ])
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

  it('reports agent profiles with invalid frontmatter', () => {
    const agentsDir = path.join(dir, '.agentboard', 'agents')
    fs.writeFileSync(path.join(agentsDir, 'broken.md'), '---\ncolor: "#fff"\n---\nBody', 'utf8')
    const result = lintProject(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'INVALID_AGENT' && i.severity === 'error')).toBe(true)
  })

  it('reports agent files whose name is not a slug', () => {
    const agentsDir = path.join(dir, '.agentboard', 'agents')
    fs.writeFileSync(path.join(agentsDir, 'Bad Agent.md'), '---\ndescription: "X"\n---\nBody', 'utf8')
    const result = lintProject(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'INVALID_AGENT' && i.file.includes('Bad Agent'))).toBe(true)
  })

  it('reports an agent with an empty prompt', () => {
    const agentsDir = path.join(dir, '.agentboard', 'agents')
    fs.writeFileSync(path.join(agentsDir, 'hollow.md'), '---\ndescription: "Talks a lot"\n---\n   \n', 'utf8')
    const result = lintProject(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.code === 'INVALID_AGENT' && i.message.includes('empty'))).toBe(true)
  })

  it('warns when a task is assigned to an unknown agent', () => {
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    fs.writeFileSync(
      path.join(tasksDir, 'TK-92.md'),
      '---\nid: TK-92\ntitle: ghost role\nstatus: To Do\npriority: medium\nassignee: illustrator\nsprint: null\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nbody\n',
      'utf8',
    )
    const result = lintProject(dir)
    const issue = result.issues.find((i) => i.code === 'UNKNOWN_ASSIGNEE')
    expect(issue?.severity).toBe('warning')
    expect(issue?.message).toContain('illustrator')
    // warnings are reported but do not fail the lint
    expect(result.ok).toBe(true)
  })

  it('warns about unfinished tasks without acceptance criteria, but not Done ones', () => {
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    const write = (id: string, status: string) =>
      fs.writeFileSync(
        path.join(tasksDir, `${id}.md`),
        `---\nid: ${id}\ntitle: no criteria\nstatus: ${status}\npriority: medium\nassignee: scrum-master\nsprint: null\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nbody\n`,
        'utf8',
      )
    write('TK-94', 'To Do')
    write('TK-95', 'Done')
    const result = lintProject(dir)
    const flagged = result.issues.filter((i) => i.code === 'NO_ACCEPTANCE_CRITERIA')
    expect(flagged.map((i) => i.message)).toEqual([expect.stringContaining('TK-94')])
    expect(flagged[0]?.severity).toBe('warning')
    expect(result.ok).toBe(true)
  })

  it('accepts a task assigned to an existing specialized agent', () => {
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    fs.writeFileSync(
      path.join(tasksDir, 'TK-93.md'),
      '---\nid: TK-93\ntitle: styled by designer\nstatus: To Do\npriority: medium\nassignee: designer\nsprint: null\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nbody\n',
      'utf8',
    )
    const result = lintProject(dir)
    expect(result.issues.some((i) => i.code === 'UNKNOWN_ASSIGNEE')).toBe(false)
    expect(result.ok).toBe(true)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { cmdBrand, cmdClose, cmdExport, cmdLint, cmdTaskNew, parseArgs } from './index.js'
import { startServer } from '@jmrojas06/agentsprint-server'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-cli-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('parseArgs', () => {
  it('parses the brand command with a directory', () => {
    const args = parseArgs(['brand', '/tmp/foo'])
    expect(args?.command).toBe('brand')
    expect(args?.dir).toBe('/tmp/foo')
  })

  it('defaults brand dir to cwd', () => {
    const args = parseArgs(['brand'])
    expect(args?.command).toBe('brand')
    expect(args?.dir).toBe(process.cwd())
  })

  it('parses the lint command with a directory', () => {
    const args = parseArgs(['lint', '/tmp/foo'])
    expect(args?.command).toBe('lint')
    expect(args?.dir).toBe('/tmp/foo')
  })

  it('defaults lint dir to cwd', () => {
    const args = parseArgs(['lint'])
    expect(args?.command).toBe('lint')
    expect(args?.dir).toBe(process.cwd())
  })

  it('defaults fallback to true', () => {
    const args = parseArgs(['serve', '/tmp/foo'])
    expect(args?.fallback).toBe(true)
  })

  it('parses --no-fallback flag', () => {
    const args = parseArgs(['serve', '/tmp/foo', '--no-fallback'])
    expect(args?.fallback).toBe(false)
  })

  it('parses --port and --no-fallback together', () => {
    const args = parseArgs(['serve', '--port', '5000', '--no-fallback', '/tmp/foo'])
    expect(args?.port).toBe(5000)
    expect(args?.fallback).toBe(false)
  })

  it('parses task new with template and vars', () => {
    const args = parseArgs(['task', 'new', 'Fix login', dir, '--template', 'bug-report', '--var', 'summary=crash'])
    expect(args?.command).toBe('task-new')
    expect(args?.dir).toBe(dir)
    expect(args?.title).toBe('Fix login')
    expect(args?.template).toBe('bug-report')
    expect(args?.vars).toEqual({ summary: 'crash' })
  })

  it('parses task new without a title or template', () => {
    const args = parseArgs(['task', 'new'])
    expect(args?.command).toBe('task-new')
    expect(args?.title).toBeUndefined()
    expect(args?.template).toBeUndefined()
  })

  it('parses export md with dir and --sprint', () => {
    const args = parseArgs(['export', 'md', '/tmp/foo', '--sprint', '2'])
    expect(args?.command).toBe('export')
    expect(args?.exportFormat).toBe('md')
    expect(args?.dir).toBe('/tmp/foo')
    expect(args?.sprintId).toBe(2)
  })

  it('defaults export dir to cwd and sprint to undefined', () => {
    const args = parseArgs(['export', 'md'])
    expect(args?.command).toBe('export')
    expect(args?.dir).toBe(process.cwd())
    expect(args?.sprintId).toBeUndefined()
  })
})

describe('cmdTaskNew', () => {
  it('creates a task from a template rendering variables', async () => {
    ProjectStore.init(dir, { sample: true })
    await cmdTaskNew(dir, undefined, 'bug-report', { summary: 'Board crashes', title: 'Bug: Board crashes' })
    const store = ProjectStore.open(dir)
    const created = store.state.tasks.filter((t) => t.title === 'Bug: Board crashes')
    expect(created).toHaveLength(1)
    expect(created[0]!.priority).toBe('high')
    expect(created[0]!.tags).toEqual(['bug'])
  })

  it('creates a plain task when no template is given', async () => {
    ProjectStore.init(dir, { sample: true })
    await cmdTaskNew(dir, 'Plain task', undefined, {})
    const store = ProjectStore.open(dir)
    expect(store.state.tasks.some((t) => t.title === 'Plain task')).toBe(true)
  })

  it('exits when the template does not exist', async () => {
    ProjectStore.init(dir, { sample: true })
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(cmdTaskNew(dir, undefined, 'nope', {})).rejects.toThrow('exit')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Template not found: nope'))
    exit.mockRestore()
    err.mockRestore()
  })
})

describe('cmdBrand', () => {
  it('prints the brand section when configured', async () => {
    ProjectStore.init(dir, { sample: true })
    const store = ProjectStore.open(dir)
    store.updateBrand({ name: 'Acme Labs', guidelines: 'Always use primary.' })

    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await cmdBrand(dir)
    const out = spy.mock.calls.map((c) => String(c[0])).join('')
    spy.mockRestore()

    expect(out).toContain('## Brand guidelines')
    expect(out).toContain('Acme Labs')
  })

  it('reports when no brand is configured', async () => {
    ProjectStore.init(dir, { sample: true })
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await cmdBrand(dir)
    const out = spy.mock.calls.map((c) => String(c[0])).join('')
    spy.mockRestore()
    expect(out).toContain('No brand configured')
  })
})

describe('cmdLint', () => {
  it('returns 0 and prints healthy message for a valid board', async () => {
    ProjectStore.init(dir, { sample: true })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const code = await cmdLint(dir)
    expect(code).toBe(0)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('healthy'))
    spy.mockRestore()
  })

  it('returns 1 and prints issues for a broken board', async () => {
    ProjectStore.init(dir, { sample: true })
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    fs.writeFileSync(
      path.join(tasksDir, 'BAD.md'),
      '---\nid: TK-1\ntitle: Bad: YAML\nstatus: To Do\n---\nboom\n',
      'utf8',
    )
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const code = await cmdLint(dir)
    expect(code).toBe(1)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Found'))
    spy.mockRestore()
  })

  it('returns 1 when no board exists', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-cli-noboard-'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const code = await cmdLint(empty)
    expect(code).toBe(1)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('NO_BOARD'))
    spy.mockRestore()
    fs.rmSync(empty, { recursive: true, force: true })
  })
})

describe('cmdClose', () => {
  it('closes a sprint and appends the retro to learnings.md', async () => {
    ProjectStore.init(dir, { sample: true })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await cmdClose(dir, 1, { retro: true })
    spy.mockRestore()
    const learningsPath = path.join(dir, '.agentboard', 'learnings.md')
    expect(fs.existsSync(learningsPath)).toBe(true)
    expect(fs.readFileSync(learningsPath, 'utf8')).toContain('## Sprint 1 retro —')
    const reopened = ProjectStore.open(dir)
    expect(reopened.state.sprints.find((s) => s.id === 1)?.status).toBe('closed')
  })

  it('skips the retro with --no-retro', async () => {
    ProjectStore.init(dir, { sample: true })
    const args = parseArgs(['close', dir, '--no-retro'])
    expect(args?.retro).toBe(false)
    expect(args?.command).toBe('close')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await cmdClose(dir, 1, { retro: false })
    spy.mockRestore()
    expect(fs.existsSync(path.join(dir, '.agentboard', 'learnings.md'))).toBe(false)
  })

  it('parses bare sprint ids and flags', () => {
    const a = parseArgs(['close', '2'])
    expect(a?.command).toBe('close')
    expect(a?.sprintId).toBe(2)
    expect(a?.retro).toBe(true)
    const b = parseArgs(['close', '/tmp/foo', '3'])
    expect(b?.dir).toBe('/tmp/foo')
    expect(b?.sprintId).toBe(3)
  })
})

describe('cmdExport', () => {
  it('writes a BOARD.md snapshot of the whole board', async () => {
    ProjectStore.init(dir, { sample: true })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await cmdExport(dir, 'md', undefined)
    spy.mockRestore()
    const target = path.join(dir, 'BOARD.md')
    expect(fs.existsSync(target)).toBe(true)
    const md = fs.readFileSync(target, 'utf8')
    expect(md).toContain('## Sprints')
    expect(md).toContain('## Tasks')
    expect(md).toContain('## Retro & learnings')
    expect(md).toContain('**TK-1** — ')
  })

  it('exports a single sprint with --sprint', async () => {
    ProjectStore.init(dir, { sample: true })
    const store = ProjectStore.open(dir)
    const sprint = store.createSprint('Isolated')
    store.createTask({ title: 'Only mine', sprint: sprint.id })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await cmdExport(dir, 'md', sprint.id)
    spy.mockRestore()
    const md = fs.readFileSync(path.join(dir, 'BOARD.md'), 'utf8')
    expect(md).toContain('Only mine')
    expect(md).not.toContain('TK-1')
  })
})

describe('port fallback', () => {
  it('falls back to next port when fallback is enabled', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-cli-fallback-'))
    ProjectStore.init(dir, { sample: true })
    ProjectStore.init(dir2, { sample: true })

    const first = await startServer({ rootDir: dir, port: 0, fallback: true, host: '127.0.0.1' })
    const firstPort = Number(first.url.split(':').pop())

    const second = await startServer({ rootDir: dir2, port: firstPort, fallback: true, host: '127.0.0.1' })
    const secondPort = Number(second.url.split(':').pop())
    expect(secondPort).toBe(firstPort + 1)
    expect(second.url).toContain(`http://127.0.0.1:${secondPort}`)

    await first.close()
    await second.close()
    fs.rmSync(dir2, { recursive: true, force: true })
  })

  it('throws EADDRINUSE when fallback is disabled', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-cli-nofallback-'))
    ProjectStore.init(dir, { sample: true })
    ProjectStore.init(dir2, { sample: true })

    const first = await startServer({ rootDir: dir, port: 0, fallback: false, host: '127.0.0.1' })
    const blockedPort = Number(first.url.split(':').pop())

    await expect(
      startServer({ rootDir: dir2, port: blockedPort, fallback: false }),
    ).rejects.toThrow()

    await first.close()
    fs.rmSync(dir2, { recursive: true, force: true })
  })
})
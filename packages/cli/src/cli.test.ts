import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { cmdAgents, cmdAgentsSync, cmdBrand, cmdClose, cmdConnect, cmdContext, cmdDispatch, cmdExport, cmdHandoff, cmdLint, cmdSkills, cmdTaskNew, installContextHook, parseArgs } from './index.js'
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

  it('parses --var values that contain "="', () => {
    const args = parseArgs(['task', 'new', 'Fix login', dir, '--var', 'query=a=b&c=d'])
    expect(args?.vars).toEqual({ query: 'a=b&c=d' })
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

  it('rejects path traversal template names with a clear error', async () => {
    ProjectStore.init(dir, { sample: true })
    fs.writeFileSync(path.join(dir, 'secret.md'), '---\ntitle: leaked\n---\n')
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(cmdTaskNew(dir, undefined, '../secret', {})).rejects.toThrow('exit')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Invalid template name'))
    expect(ProjectStore.open(dir).state.tasks.some((t) => t.title === 'leaked')).toBe(false)
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
describe('agents, dispatch and connect', () => {
  it('parses agents, agents sync and dispatch', () => {
    expect(parseArgs(['agents', '/tmp/x'])).toMatchObject({ command: 'agents', dir: '/tmp/x' })
    expect(parseArgs(['agents', 'sync', '/tmp/x'])).toMatchObject({ command: 'agents-sync', dir: '/tmp/x' })
    expect(parseArgs(['agents', 'sync'])).toMatchObject({ command: 'agents-sync', dir: process.cwd() })
    expect(parseArgs(['dispatch', '/tmp/x', '--sprint', '2'])).toMatchObject({ command: 'dispatch', dir: '/tmp/x', sprintId: 2 })
    expect(parseArgs(['connect', '/tmp/x'])).toMatchObject({ command: 'connect', dir: '/tmp/x' })
    expect(parseArgs(['mcp', '/tmp/x'])).toMatchObject({ command: 'mcp', dir: '/tmp/x' })
  })

  it('agents lists the roster and agents sync restores a deleted default', async () => {
    const store = ProjectStore.init(dir, { sample: true })
    store.deleteAgent('docs')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await cmdAgentsSync(dir)
    expect(fs.existsSync(path.join(dir, '.claude', 'agents', 'docs.md'))).toBe(true)
    await cmdAgents(dir)
    const out = log.mock.calls.map((c) => String(c[0])).join('\n')
    log.mockRestore()
    expect(out).toContain('Added default agents: docs')
    expect(out).toMatch(/designer\s+Designer/)
    expect(out).toContain('9 agent(s)')
  })

  it('dispatch prints the plan for the active sprint', async () => {
    ProjectStore.init(dir, { sample: true })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await cmdDispatch(dir)
    const out = write.mock.calls.map((c) => String(c[0])).join('')
    write.mockRestore()
    expect(out).toContain('# Dispatch plan')
    expect(out).toContain('Wave 1')
  })

  it('connect merges the agentsprint server into .mcp.json', async () => {
    ProjectStore.init(dir, { sample: true })
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }), 'utf8')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await cmdConnect(dir, { cliEntry: '/opt/agentboard/index.js' })
    await cmdConnect(dir, { cliEntry: '/opt/agentboard/index.js' })
    log.mockRestore()
    const config = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'))
    expect(config.mcpServers.other).toEqual({ command: 'x' })
    expect(config.mcpServers.agentsprint).toEqual({ type: 'stdio', command: process.execPath, args: ['/opt/agentboard/index.js', 'mcp', path.resolve(dir)] })
  })
})

describe('session continuity commands', () => {
  it('parses context, handoff and skills', () => {
    expect(parseArgs(['context', '/tmp/x', '--hook'])).toMatchObject({ command: 'context', dir: '/tmp/x', hook: true })
    expect(parseArgs(['skills', '/tmp/x'])).toMatchObject({ command: 'skills', dir: '/tmp/x' })
    expect(
      parseArgs(['handoff', '/tmp/x', '--summary', 'API done', '--done', 'TK-1', '--next', 'TK-2', '--next', 'TK-3', '--blocker', 'CI', '--author', 'ana']),
    ).toMatchObject({
      command: 'handoff',
      dir: '/tmp/x',
      handoff: { summary: 'API done', done: ['TK-1'], next: ['TK-2', 'TK-3'], blockers: ['CI'], author: 'ana' },
    })
  })

  it('handoff appends to the journal and context prints it', async () => {
    ProjectStore.init(dir, { sample: true })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await cmdHandoff(dir, { summary: 'Planned the sprint', done: [], next: ['Start TK-1'], blockers: [], author: 'ana' })
    log.mockRestore()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await cmdContext(dir)
    const out = write.mock.calls.map((c) => String(c[0])).join('')
    write.mockRestore()
    expect(out).toContain('# Where we are')
    expect(out).toContain('Planned the sprint')
    expect(out).toContain('Start TK-1')
  })

  it('context --hook stays silent without a board, plain context throws', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await cmdContext(dir, { hook: true })
    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
    await expect(cmdContext(dir)).rejects.toThrow(/No AgentSprint board/)
  })

  it('skills lists installed skills without crashing on an empty roster', async () => {
    ProjectStore.init(dir, { sample: false })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await cmdSkills(dir)
    log.mockRestore()
    warn.mockRestore()
  })

  it('installs one SessionStart hook, keeping other settings and hooks', () => {
    const file = path.join(dir, '.claude', 'settings.local.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }),
      'utf8',
    )
    installContextHook(dir, '/opt/agentboard/index.js')
    installContextHook(dir, '/opt/agentboard/index.js')
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(settings.permissions).toEqual({ allow: ['Bash(ls)'] })
    const commands = settings.hooks.SessionStart.flatMap((g: { hooks: Array<{ command: string }> }) => g.hooks.map((h) => h.command))
    expect(commands).toHaveLength(2)
    expect(commands[0]).toBe('echo hi')
    expect(commands[1]).toContain('/opt/agentboard/index.js')
    expect(commands[1]).toMatch(/ context .* --hook$/)
  })
})

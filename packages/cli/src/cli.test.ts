import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '@agentsprint/core'
import { cmdBrand, cmdClose, cmdLint, parseArgs } from './index.js'
import { startServer } from '@agentsprint/server'

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
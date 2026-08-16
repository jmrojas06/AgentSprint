import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '@agentsprint/core'
import { cmdBrand, parseArgs } from './index.js'

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
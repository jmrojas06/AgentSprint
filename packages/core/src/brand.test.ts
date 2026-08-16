import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, buildBrandSection, buildTaskSpec, hasBrand } from '../src/index.js'

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-brand-'))
  store = ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('brand', () => {
  it('creates a brand template on init', () => {
    expect(fs.existsSync(path.join(dir, '.agentboard', 'brand.md'))).toBe(true)
    expect(hasBrand(store.getBrand())).toBe(false)
  })

  it('round-trips a configured brand through the file', () => {
    store.updateBrand({
      name: 'Acme Labs',
      tagline: 'Build better software',
      tone: 'friendly',
      colors: { primary: '#6366f1', accent: '#22c55e' },
      fonts: { heading: 'Inter' },
      assets: [{ name: 'Design system', path: 'docs/design/figma.md' }],
      guidelines: 'Always use the primary color for buttons.',
    })
    const reopened = ProjectStore.open(dir)
    const brand = reopened.getBrand()
    expect(brand.name).toBe('Acme Labs')
    expect(brand.colors.primary).toBe('#6366f1')
    expect(brand.fonts.heading).toBe('Inter')
    expect(brand.assets[0]?.path).toBe('docs/design/figma.md')
    expect(brand.guidelines).toContain('primary color')
    expect(hasBrand(brand)).toBe(true)
  })

  it('is included in project state', () => {
    store.updateBrand({ name: 'Acme Labs' })
    expect(store.state.brand.name).toBe('Acme Labs')
  })
})

describe('brand spec injection', () => {
  it('buildBrandSection returns null for an empty brand', () => {
    expect(buildBrandSection(store.getBrand())).toBeNull()
  })

  it('injects brand guidelines into task specs', () => {
    store.updateBrand({
      name: 'Acme Labs',
      colors: { primary: '#6366f1' },
      assets: [{ name: 'Design system', path: 'docs/design/figma.md' }],
      guidelines: 'Always use the primary color.',
    })
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const spec = buildTaskSpec(task, null, 'demo', store.getBrand())
    expect(spec).toContain('## Brand guidelines')
    expect(spec).toContain('**Company:** Acme Labs')
    expect(spec).toContain('`primary`: #6366f1')
    expect(spec).toContain('docs/design/figma.md')
    expect(spec).toContain('Always use the primary color.')
  })

  it('does not inject brand when absent', () => {
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const spec = buildTaskSpec(task, null, 'demo')
    expect(spec).not.toContain('## Brand guidelines')
  })
})

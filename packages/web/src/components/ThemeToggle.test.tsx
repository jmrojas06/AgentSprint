import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoredTheme, ThemeToggle } from './ThemeToggle'

const STORAGE_KEY = 'agentsprint-theme'
let matchesLight = false
const mqListeners = new Set<() => void>()

function mockMatchMedia() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('light') ? matchesLight : !matchesLight,
    addEventListener: (_type: string, cb: () => void) => mqListeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => mqListeners.delete(cb),
  }))
}

function isLightApplied(): boolean {
  return document.documentElement.classList.contains('light')
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  mqListeners.clear()
  matchesLight = false
  mockMatchMedia()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ThemeToggle', () => {
  it('starts as system theme and resolves via prefers-color-scheme', () => {
    matchesLight = true
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'System theme' })).toBeTruthy()
    expect(isLightApplied()).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('cycles light → dark → system and persists each step', () => {
    render(<ThemeToggle />)
    const button = screen.getByRole('button')

    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Light theme' })).toBeTruthy()
    expect(isLightApplied()).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')

    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeTruthy()
    expect(isLightApplied()).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')

    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'System theme' })).toBeTruthy()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('re-resolves the system preference when the media query changes', () => {
    render(<ThemeToggle />)
    expect(isLightApplied()).toBe(false)

    matchesLight = true
    for (const cb of mqListeners) cb()

    expect(isLightApplied()).toBe(true)
  })

  it('restores a stored preference instead of the system one', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeTruthy()
    expect(isLightApplied()).toBe(false)
  })
})

describe('getStoredTheme', () => {
  it('returns the stored valid value', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    expect(getStoredTheme()).toBe('light')
  })

  it('falls back to system for corrupt values', () => {
    localStorage.setItem(STORAGE_KEY, 'banana')
    expect(getStoredTheme()).toBe('system')
  })

  it('falls back to system when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    try {
      expect(getStoredTheme()).toBe('system')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

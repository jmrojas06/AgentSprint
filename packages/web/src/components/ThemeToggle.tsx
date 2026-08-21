import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

const STORAGE_KEY = 'agentsprint-theme'

type ThemePref = 'light' | 'dark' | 'system'

function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function apply(pref: ThemePref): void {
  document.documentElement.classList.toggle('light', resolveTheme(pref) === 'light')
}

export function getStoredTheme(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** Light/dark toggle. Cycles light → dark → system; persisted in localStorage. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => (typeof window === 'undefined' ? 'system' : getStoredTheme()))

  useEffect(() => {
    apply(pref)
    try {
      if (pref === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      /* private mode — theme still works for this session */
    }
  }, [pref])

  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const cycle = () => setPref((p) => (p === 'light' ? 'dark' : p === 'dark' ? 'system' : 'light'))

  const label = pref === 'light' ? 'Light theme' : pref === 'dark' ? 'Dark theme' : 'System theme'
  const Icon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${label} — click to switch`}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

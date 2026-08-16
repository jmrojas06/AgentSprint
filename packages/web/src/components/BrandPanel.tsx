import { useState } from 'react'
import { Check, Palette, Plus, Save, Trash2, X } from 'lucide-react'
import type { Brand, BrandAsset } from '../types'

interface Props {
  brand: Brand
  onSave: (patch: Partial<Brand>) => void
}

const COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'text'] as const
const FONT_KEYS = ['heading', 'body'] as const

const field =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500'
const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500'
const colorLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1)

export function BrandPanel({ brand, onSave }: Props) {
  const [draft, setDraft] = useState<Brand>(brand)
  const [assetName, setAssetName] = useState('')
  const [assetPath, setAssetPath] = useState('')
  const [saved, setSaved] = useState(false)

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(brand)

  const save = () => {
    onSave(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const set = <K extends keyof Brand>(key: K, value: Brand[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const setColor = (key: (typeof COLOR_KEYS)[number], value: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }))

  const setFont = (key: (typeof FONT_KEYS)[number], value: string) =>
    setDraft((d) => ({ ...d, fonts: { ...d.fonts, [key]: value } }))

  const addAsset = () => {
    if (!assetName.trim() || !assetPath.trim()) return
    setDraft((d) => ({ ...d, assets: [...d.assets, { name: assetName.trim(), path: assetPath.trim() }] }))
    setAssetName('')
    setAssetPath('')
  }

  const removeAsset = (i: number) =>
    setDraft((d) => ({ ...d, assets: d.assets.filter((_, j) => j !== i) }))

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <Palette className="h-3.5 w-3.5 text-violet-400" /> Brand kit
      </h2>
      <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
        Your company identity and design rules. Injected into every task spec so agents follow your brand. Saved to{' '}
        <code className="rounded bg-zinc-950 px-1">.agentboard/brand.md</code>.
      </p>

      <div className="space-y-3">
        <div>
          <label className={label}>Company name</label>
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="My Company" className={field} />
        </div>
        <div>
          <label className={label}>Tagline</label>
          <input value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Short one-liner" className={field} />
        </div>
        <div>
          <label className={label}>Mission</label>
          <textarea
            value={draft.mission}
            onChange={(e) => set('mission', e.target.value)}
            rows={2}
            placeholder="Why does the company exist?"
            className={field}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Tone of voice</label>
            <input value={draft.tone} onChange={(e) => set('tone', e.target.value)} placeholder="friendly, technical…" className={field} />
          </div>
          <div>
            <label className={label}>Logo</label>
            <input value={draft.logo} onChange={(e) => set('logo', e.target.value)} placeholder="docs/logo.svg" className={field} />
          </div>
        </div>

        <div>
          <label className={label}>Colors</label>
          <div className="grid grid-cols-2 gap-1.5">
            {COLOR_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-1">
                <input
                  type="color"
                  value={draft.colors[k] || '#000000'}
                  onChange={(e) => setColor(k, e.target.value)}
                  className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span className="w-16 text-[11px] capitalize text-zinc-400">{colorLabel(k)}</span>
                <input
                  value={draft.colors[k]}
                  onChange={(e) => setColor(k, e.target.value)}
                  className="w-full bg-transparent font-mono text-[11px] text-zinc-300 outline-none"
                  placeholder="#000000"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Heading font</label>
            <input value={draft.fonts.heading} onChange={(e) => setFont('heading', e.target.value)} placeholder="Inter" className={field} />
          </div>
          <div>
            <label className={label}>Body font</label>
            <input value={draft.fonts.body} onChange={(e) => setFont('body', e.target.value)} placeholder="Inter" className={field} />
          </div>
        </div>

        <div>
          <label className={label}>Design files</label>
          <ul className="mb-1.5 space-y-1">
            {draft.assets.map((a: BrandAsset, i) => (
              <li key={i} className="flex items-center gap-2 rounded bg-zinc-950/60 px-2 py-1 text-[11px]">
                <span className="font-medium text-zinc-300">{a.name}</span>
                <code className="truncate text-zinc-500">{a.path}</code>
                <button onClick={() => removeAsset(i)} className="ml-auto rounded p-0.5 text-zinc-500 hover:text-red-400">
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1">
            <input
              value={assetName}
              onChange={(e) => setAssetName(e.target.value)}
              placeholder="Design system"
              className={field + ' w-1/3'}
            />
            <input
              value={assetPath}
              onChange={(e) => setAssetPath(e.target.value)}
              placeholder="docs/design/figma.md"
              className={field + ' flex-1'}
            />
            <button onClick={addAsset} className="rounded-md bg-zinc-800 px-2 text-zinc-300 hover:bg-zinc-700" title="Add design file">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <label className={label}>Guidelines</label>
          <textarea
            value={draft.guidelines}
            onChange={(e) => set('guidelines', e.target.value)}
            rows={6}
            placeholder={'Write brand rules here.\nExample: Always use the primary color for primary buttons; keep copy short and imperative; …'}
            className={field}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={save}
            disabled={!dirty}
            className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saved ? 'Saved!' : 'Save brand'}
          </button>
          {!dirty && <span className="text-[11px] text-zinc-600">No changes</span>}
        </div>
      </div>
    </div>
  )
}

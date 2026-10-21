import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { setTokenPrompt } from '../api'
import { useDialogFocus } from '../hooks/useDialogFocus'

interface Pending {
  attempt: (token: string) => Promise<boolean>
  resolve: (accepted: boolean) => void
}

/**
 * Dialog the API layer opens whenever the server answers 401. Saving re-sends
 * the refused request with the token; a token the server refuses keeps the
 * dialog open with an error instead of being stored.
 */
export function TokenPrompt({ onAccepted }: { onAccepted?: () => void }) {
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => setTokenPrompt((attempt) => new Promise<boolean>((resolve) => setPending({ attempt, resolve }))), [])

  if (!pending) return null

  const close = (accepted: boolean) => {
    pending.resolve(accepted)
    setPending(null)
    if (accepted) onAccepted?.()
  }
  return <TokenDialog attempt={pending.attempt} onClose={close} />
}

/** Mounted only while a prompt is open, so focus moves in on open and back on close. */
function TokenDialog({ attempt, onClose }: { attempt: Pending['attempt']; onClose: (accepted: boolean) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Top-most surface: owns Tab and Escape even when opened over the side drawer.
  useDialogFocus(formRef, () => onClose(false), inputRef)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = token.trim()
    if (!value || checking) return
    setChecking(true)
    setError(null)
    try {
      if (await attempt(value)) {
        onClose(true)
        return
      }
      setError('Token rejected. Check the value and try again.')
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setChecking(false)
    }
    inputRef.current?.select()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-prompt-title"
        aria-describedby="token-prompt-desc"
        onSubmit={submit}
        onKeyDown={(e) => {
          // Stop here so a modal underneath that listens on window (TaskModal) keeps its edits.
          if (e.key !== 'Escape') return
          e.stopPropagation()
          onClose(false)
        }}
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        data-testid="token-prompt"
      >
        <h2 id="token-prompt-title" className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <KeyRound className="h-4 w-4 text-indigo-400" /> Token required
        </h2>
        <p id="token-prompt-desc" className="mt-1 text-xs text-zinc-400">
          This board is protected. Enter the token the server was started with; your last action is sent again once it
          is accepted.
        </p>
        <label htmlFor="token-prompt-input" className="mb-1 mt-3 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Bearer token
        </label>
        <input
          ref={inputRef}
          id="token-prompt-input"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'token-prompt-error' : undefined}
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"
          data-testid="token-input"
        />
        {error && (
          <p id="token-prompt-error" role="alert" className="mt-1.5 text-xs text-red-300">
            {error}
          </p>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">
          Saved in this browser as <code className="rounded border border-zinc-700 px-1 font-mono">agentsprint-token</code>.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={checking || !token.trim()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            data-testid="token-save"
          >
            {checking ? 'Checking…' : 'Save and retry'}
          </button>
        </div>
      </form>
    </div>
  )
}

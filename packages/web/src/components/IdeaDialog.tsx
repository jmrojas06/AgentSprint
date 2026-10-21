import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, ClipboardCopy, Lightbulb, SquareTerminal, X } from 'lucide-react'
import type { Task } from '../types'
import { AssigneeChip } from '../agents'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { api } from '../api'
import { IDEA_DOCS_URL, buildIdeaCli } from '../ideaPrompt'
import { cx, priorityDot } from '../ui'

interface Props {
  /** The board's tasks, live: the ones that appear while the dialog is open are the plan. */
  tasks: Task[]
  onOpenTask: (id: string) => void
  onClose: () => void
}

type Copied = 'command' | 'cli' | null

/** Shortcut hint in the platform's own words (Cmd on Apple, Ctrl elsewhere). */
const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform) ? '⌘' : 'Ctrl'

/** How long typing pauses before the prompt is rendered again. */
const RENDER_DELAY_MS = 250

const promptKey = (...fields: string[]) => JSON.stringify(fields)

/** The full prompt, rendered by the server, tagged with the fields it was rendered from. */
async function renderPrompt(idea: string, stack: string, scope: string): Promise<{ key: string; text: string }> {
  const { text } = await api.ideaPrompt({ idea, stack, scope })
  return { key: promptKey(idea, stack, scope), text }
}

/**
 * Idea → MVP without an LLM in the browser: the dialog helps write the idea
 * and shows the full `idea-to-mvp` prompt the server renders from it, to paste
 * into Claude Code as a message (or start `claude` with). Tasks the
 * orchestrator creates while it is open are listed as they land on the board.
 */
export function IdeaDialog({ tasks, onOpenTask, onClose }: Props) {
  const [idea, setIdea] = useState('')
  const [stack, setStack] = useState('')
  const [scope, setScope] = useState('')
  const [copied, setCopied] = useState<Copied>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const ideaRef = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ids = useId()
  // Focus goes to the idea field, Tab stays inside, Escape closes, focus returns to the trigger.
  useDialogFocus(dialogRef, onClose, ideaRef)

  // Tasks already on the board when the dialog opened; anything new is the plan.
  const [baseline] = useState(() => new Set(tasks.map((t) => t.id)))
  const created = useMemo(() => tasks.filter((t) => !baseline.has(t.id)), [tasks, baseline])

  // The last prompt the server rendered, and for which fields (`key`).
  const [rendered, setRendered] = useState<{ key: string; text: string } | null>(null)
  const hasIdea = idea.trim() !== ''

  useEffect(() => {
    if (!hasIdea) return
    let live = true
    const t = setTimeout(() => {
      renderPrompt(idea, stack, scope)
        .then((next) => {
          if (!live) return
          setRendered(next)
          setError(null)
        })
        .catch((err: Error) => live && setError(`Could not build the prompt: ${err.message}`))
    }, RENDER_DELAY_MS)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [hasIdea, idea, stack, scope])

  // While typing, the previous prompt stays on screen (dimmed) until the new one
  // lands; after an error it is hidden, since it may belong to another idea.
  const fresh = rendered?.key === promptKey(idea, stack, scope)
  const command = hasIdea && rendered && !error ? rendered.text : ''
  const cli = buildIdeaCli(command)
  const commandPlaceholder = !hasIdea
    ? 'Write the idea above: the full prompt appears here.'
    : error
      ? 'No prompt: see the message above.'
      : 'Building the prompt…'

  // The message sits above the prompts; bring it into view when it appears
  // (after Copy the dialog may be scrolled to the bottom).
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])

  const copy = async (which: Exclude<Copied, null>) => {
    if (!hasIdea) {
      ideaRef.current?.focus()
      return
    }
    let prompt: string
    try {
      const current = rendered?.key === promptKey(idea, stack, scope) ? rendered : await renderPrompt(idea, stack, scope)
      setRendered(current)
      prompt = current.text
    } catch (err) {
      setError(`Could not build the prompt: ${(err as Error).message}`)
      return
    }
    try {
      await navigator.clipboard.writeText(which === 'command' ? prompt : buildIdeaCli(prompt))
      setError(null)
      setCopied(which)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), 1800)
    } catch {
      setError('Clipboard unavailable: select the prompt below and copy it manually.')
    }
  }

  const field =
    'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500'
  const label = 'mb-1.5 block text-xs font-medium text-zinc-300'

  return (
    <div className="scrim-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-desc`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none"
        data-testid="idea-dialog"
      >
        <div className="flex items-start gap-3 border-b border-zinc-800 p-4">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id={`${ids}-title`} className="text-sm font-semibold text-zinc-100">
              Start from an idea
            </h2>
            <p id={`${ids}-desc`} className="mt-0.5 text-pretty text-xs leading-relaxed text-zinc-400">
              Copy the prompt and paste it into Claude Code as a message: it cuts the idea to an MVP and creates a plan of linked tasks that appears on
              this board live.{' '}
              <a
                href={IDEA_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-indigo-300 underline decoration-indigo-300/40 underline-offset-2 hover:decoration-indigo-300"
              >
                How it works
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">(docs/agents.md, opens in a new tab)</span>
              </a>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-m-1 ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          <div>
            <label className={label} htmlFor={`${ids}-idea`}>
              Your idea
            </label>
            <textarea
              ref={ideaRef}
              id={`${ids}-idea`}
              name="idea"
              rows={4}
              autoComplete="off"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void copy('command')
                }
              }}
              aria-describedby={`${ids}-idea-help`}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              className={cx(field, 'resize-y leading-relaxed')}
              placeholder="A shared shopping list for flatmates: add items, tick them off in the shop, see who bought what…"
              data-testid="idea-input"
            />
            <p id={`${ids}-idea-help`} className="mt-1.5 text-[11px] text-zinc-500">
              In your own words: who it is for and the one thing they should be able to do.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor={`${ids}-stack`}>
                Stack <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input
                id={`${ids}-stack`}
                name="stack"
                autoComplete="off"
                spellCheck={false}
                value={stack}
                onChange={(e) => setStack(e.target.value)}
                className={field}
                placeholder="Vite + React, SQLite…"
                data-testid="idea-stack"
              />
            </div>
            <div>
              <label className={label} htmlFor={`${ids}-scope`}>
                Scope <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input
                id={`${ids}-scope`}
                name="scope"
                autoComplete="off"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                aria-describedby={`${ids}-scope-help`}
                className={field}
                placeholder="One list, no accounts yet…"
                data-testid="idea-scope"
              />
              <p id={`${ids}-scope-help`} className="mt-1.5 text-[11px] text-zinc-500">
                What the first version leaves out, in a few words.
              </p>
            </div>
          </div>

          <section aria-labelledby={`${ids}-out`} className="space-y-3">
            <h3 id={`${ids}-out`} className="text-xs font-semibold text-zinc-200">
              Prompt for Claude Code
            </h3>
            {error && (
              <p ref={errorRef} role="alert" className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
            <div aria-busy={hasIdea && !fresh && !error} className={cx('space-y-3 transition-opacity', command && !fresh && 'opacity-60')}>
              <CommandBlock
                label="Paste into Claude Code, in this project, as a message"
                text={command}
                placeholder={commandPlaceholder}
                testId="idea-command"
              />
              <CommandBlock
                label="Or start Claude Code from a terminal in this folder"
                text={cli}
                placeholder="claude '<the prompt above>'"
                testId="idea-cli"
                icon
              />
            </div>
          </section>

          <section aria-label="Tasks created" aria-live="polite" data-testid="idea-created">
            {created.length > 0 && (
              <>
                <h3 className="mb-1 flex items-baseline gap-2 text-xs font-semibold text-zinc-200">
                  Plan on the board
                  <span className="tabular font-normal text-zinc-500">
                    {created.length} new {created.length === 1 ? 'task' : 'tasks'}
                  </span>
                </h3>
                <ul className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-1">
                  {created.slice(0, 15).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onOpenTask(t.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800/70"
                      >
                        <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', priorityDot[t.priority])} aria-hidden="true" />
                        <span className="w-12 shrink-0 font-mono text-[11px] text-zinc-500" translate="no">
                          {t.id}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{t.title}</span>
                        <AssigneeChip assignee={t.assignee} className="hidden shrink-0 sm:inline" />
                      </button>
                    </li>
                  ))}
                  {created.length > 15 && <li className="px-2 py-1.5 text-[11px] text-zinc-500">and {created.length - 15} more on the board</li>}
                </ul>
              </>
            )}
          </section>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 p-4 sm:flex-row sm:items-center sm:gap-3">
          <p className="hidden min-w-0 flex-1 text-[11px] leading-snug text-zinc-500 sm:block">
            {created.length > 0
              ? 'Keep this open to follow the plan, or close it and watch the board.'
              : hasIdea
                ? 'New tasks show up here as Claude Code creates them.'
                : 'Write the idea to get the prompt.'}
          </p>
          <button
            type="button"
            onClick={() => void copy('cli')}
            disabled={!hasIdea}
            className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="idea-copy-cli"
          >
            {copied === 'cli' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied === 'cli' ? 'Copied' : 'Copy CLI command'}
          </button>
          <button
            type="button"
            onClick={() => void copy('command')}
            disabled={!hasIdea}
            className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="idea-copy"
          >
            {copied === 'command' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied === 'command' ? 'Copied' : 'Copy'}
            <kbd aria-hidden="true" className="ml-1 hidden rounded border border-white/25 px-1 font-mono text-[10px] font-normal text-white/80 sm:inline">
              {`${MOD_KEY}\u00a0↵`}
            </kbd>
          </button>
          <span role="status" className="sr-only">
            {copied === 'command' ? 'Prompt copied' : copied === 'cli' ? 'CLI command copied' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

/** The generated text, selectable, in the terminal face; a muted example until there is an idea. */
function CommandBlock({ label, text, placeholder, testId, icon }: { label: string; text: string; placeholder: string; testId: string; icon?: boolean }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
        {icon && <SquareTerminal className="h-3 w-3" aria-hidden="true" />}
        {label}
      </p>
      <pre
        className={cx(
          'max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-xs leading-relaxed',
          text ? 'select-all text-zinc-200' : 'text-zinc-500',
        )}
        translate="no"
        data-testid={testId}
      >
        {text || placeholder}
      </pre>
    </div>
  )
}

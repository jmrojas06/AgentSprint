# Specialized agents & subagents

AgentSprint ships a team of specialized agents and turns each one into a real
**Claude Code subagent**. You assign a task to a specialist, and the
orchestrator (your main Claude Code session) launches that subagent to build
it — several at once when the tasks are independent.

## The default team

`agentboard init` (or `agentboard agents sync` on an existing board) writes
ten profiles to `.agentboard/agents/`:

| Agent | Role | Skills preloaded |
| --- | --- | --- |
| `developer` | Smallest correct change; reuses what exists; full suite green before Review | karpathy-guidelines, principios-codigo, test-driven-development, systematic-debugging, verification-before-completion |
| `designer` | Builds the UI from the brand kit: direction, reference brands, audit, screenshots | design-taste-frontend, frontend-design, design-md-library, awesome-design-md, web-design-guidelines, playwright-cli |
| `tester` | Tests derived from acceptance criteria; edge cases first; proves tests can fail | test-driven-development, tdd, playwright-cli, verification-before-completion |
| `fixer` | Reproduce, find root cause, failing test first, smallest patch | systematic-debugging, diagnose, test-driven-development, verification-before-completion |
| `docs` | README, guides, CHANGELOG, verified against the code that ships | grill-with-docs, verification-before-completion |
| `creative-director` | Owns vision and tone; approves, revises or rejects with a direction | design-taste-frontend, design-md-library, brainstorming |
| `ideator` | Divergent options fast, then a ranked shortlist and a recommendation | brainstorming |
| `code-reviewer` | Review gate for code: diff vs. criteria, bugs, regressions; read-only | requesting-code-review, karpathy-guidelines, principios-codigo, verification-before-completion |
| `ui-reviewer` | Review gate for UI: real screens at 375px and desktop, a11y, brand; read-only | web-design-guidelines, design-taste-frontend, playwright-cli |
| `review-assistant` | Briefs the human on what waits in Review, grouped for batched questions; read-only, never decides | verification-before-completion |

A profile is one Markdown file — the filename is the agent name, the body is
its prompt:

```markdown
---
description: "Payments specialist: Stripe Checkout, webhooks and billing portal."
color: "#3b82f6"
tags: [payments]
tools: []        # optional Claude Code tool allowlist; empty = inherit all (MCP included)
disallowedTools: []  # tools it may never use, e.g. [Edit, Write] for a reviewer
skills: [stripe-best-practices]  # Claude Code skills preloaded into the subagent
model: inherit   # inherit | sonnet | opus | haiku
---

You are the **Stripe Expert**.

## Mission
...
```

Create or edit agents from the **Agents** tab of the board, with the
`agent_upsert` MCP tool, or by editing the file.

## Skills

`skills` lists Claude Code skills (by their `name:`) that are injected into
the subagent's context when it starts, so the designer begins every task with
its design skills loaded instead of having to discover them. A skill that is
not installed is skipped by Claude Code with a debug warning, so profiles stay
portable.

- `agentboard skills` lists the skills installed in `<project>/.claude/skills/`
  and `~/.claude/skills/`, which agents preload each one, and the skills an
  agent references that are missing.
- The **Agents** tab edits skills with suggestions from the installed ones and
  marks missing skills in amber; `skill_list` (MCP) and `GET /api/skills`
  return the same data.
- Task specs list the agent's skills too, so agents other than Claude Code
  know which ones to load.

## The review gate

`code-reviewer` and `ui-reviewer` are tagged `reviewer` and cannot edit files
(`disallowedTools: Edit, Write, NotebookEdit`). Their generated subagent gets a
review protocol instead of the build protocol: read the spec, inspect the diff
or the running UI, then record a verdict with `task_review`:

```json
{ "id": "TK-12", "reviewer": "code-reviewer", "verdict": "changes",
  "summary": "Empty input crashes the endpoint.",
  "findings": ["src/api/tasks.ts:42 — POST with {} throws; validate and return 400", "No test for the 404 path"] }
```

- `approve` keeps the task in Review for the human, with an "Approved" badge
  on the board.
- `changes` needs at least one finding; it moves the task back to In Progress
  and records the findings as a note, so the implementer sees them in its spec.

`sprint_dispatch` assigns the gate per task: `ui-reviewer` when the task or its
assignee is tagged design, ui, ux, frontend, web, css or a11y; `code-reviewer`
otherwise; none for decision-only agents (ideator, creative director). Tasks
already in Review appear in a **Review gate** section of the plan, except those
whose approving verdict is newer than their last change: the plan lists them as
`already approved` and skips the gate (JSON: `review[].approvedBy`). Humans can
record verdicts too, with `POST /api/tasks/:id/review`.

## Human review in chat

After the gate, the human moves work to Done, and can do it without leaving
the chat. Run the `human-review` prompt (`/mcp__agentsprint__human-review`):

1. The main session calls `review_queue`: every task in Review with its
   criteria, latest verdict and a recommendation (`approve`, `look`,
   `changes-pending`).
2. For a long queue or items that need a closer look, it launches the
   `review-assistant` subagent. Subagents cannot ask the user, so this one
   only reads: it returns a short brief per task (what changed, verdict, risk,
   recommendation), grouped into **approve in batch** and **look**, with the
   questions to ask. It is tagged `human-review`, not `reviewer`, so it is
   never a review gate. Its synced subagent is read-only by tools: the
   generator always blocks file edits and every board-changing agentsprint
   MCP tool for `human-review` agents, whatever their profile on disk says.
3. The main session asks the human in batches (`AskUserQuestion` in Claude
   Code): at most 4 questions per call, 2–4 options each, recommended option
   first. One question per sprint for its `approve` items, even when the
   same sprint also has items that need a look ("Approve these N" / "Leave in
   Review", plus "Approve all and close Sprint N" only when nothing else in
   that sprint stays open), and a separate one for anything odd, such as a
   stale approval or a criterion that no longer applies.
4. It records each answer with `review_decide` (`done`, or `changes` with
   the human's findings) and calls `sprint_close` only for a sprint the human
   chose to close once all its tasks are Done.

Without MCP, the same decisions go through the CLI:
`agentboard review --json`, `agentboard review --done TK-1,TK-2`,
`agentboard review --changes TK-3 --finding "…"` and `agentboard close . <sprint>`.

## Real subagents in `.claude/agents/`

Every profile is mirrored to `.claude/agents/<name>.md` in Claude Code's
subagent format, with the AgentSprint protocol appended (claim the task, read
its spec, tick criteria, log notes, move to Review). The sync runs:

- on `agentboard init`, `agentboard agents sync` and the `agent_sync` MCP tool;
- whenever an agent is saved or deleted (UI, API or MCP);
- while `agentboard serve` runs, every time a file in `.agentboard/agents/` changes.

It is idempotent and safe: only files carrying the `agentsprint:generated`
marker are rewritten or removed; a hand-written subagent with the same name is
never touched (it is reported as skipped). Opt out with `subagents: false` in
`.agentboard/config.yaml`.

Claude Code loads new subagents at startup — restart it (or open `/agents`)
after adding one.

When the `agentsprint` MCP server is not connected, the protocol tells each
subagent to run the same steps through the CLI instead —
`agentboard task claim|check|note|status|release|review|show . <id> --agent <name>`
(see the [CLI reference](/cli)) — and never to edit a task's frontmatter or
`## Activity` by hand. The CLI calls the same store methods as the MCP tools,
so locks, activity lines and notes come out identical either way.

## Task specs know their agent

When a task's `assignee` is an agent name, `task_spec` (and
`agentboard spec`) injects an **Agent profile** section with that agent's
prompt. Specialized assignees keep their name across status changes, and
`task_claim { id, agent: "designer" }` assigns the task to the claiming
subagent.

## Running a sprint with subagents

`sprint_dispatch` (MCP), `agentboard dispatch` (CLI), `GET /api/dispatch` and
the **Run sprint** button all compute the same plan:

- pending tasks of the sprint split into **waves**: a task lands one wave
  after its latest dependency, so the tasks inside a wave can run in parallel;
- each task gets its **subagent**: its specialized assignee, `developer` for
  workflow roles, `general-purpose` when no profile matches;
- tasks that can never start (no acceptance criteria, missing dependency,
  dependency outside the sprint, cycle) are listed as **blocked** with the
  reason; their dependents wait on them.

In Claude Code run the `run-sprint` prompt (`/mcp__agentsprint__run-sprint`)
or paste the prompt copied from the board. The orchestrator launches every
task of a wave in parallel with the Agent tool, verifies between waves, and
re-dispatches until nothing is left — then you review what is in Review.

### Parallel safety

Tasks of one wave run at the same time, so the plan checks where each one
works: its `files:` frontmatter (repo-relative paths or globs such as
`packages/web/src/App.tsx` or `packages/web/**`, validated by `agentboard lint`),
or, without it, the area of its package tags (`core`, `web`, `server`, `mcp`,
`cli` → `packages/<tag>`, `docs` → `docs`). Two tasks of the same wave that share
a file, a glob prefix or an area are flagged under their launch line —
`⚠ shares packages/web with TK-50` — with the advice to launch them with
`isolation: "worktree"` or run them in separate waves. The JSON plan lists the
same pairs in `conflicts: [{ tasks: ["TK-49", "TK-50"], shared: "packages/web" }]`.

## Idea → MVP

The `idea-to-mvp` prompt (`/mcp__agentsprint__idea-to-mvp`) takes an idea and
walks the orchestrator through: ideator + creative-director to cut the MVP,
brand kit, any missing specialist (`agent_upsert`), a sprint, one
`task_create_batch` call with every task assigned and linked by dependencies,
and finally `sprint_dispatch` to build it wave by wave.

Start it from the board: **Start from an idea** (command palette, or the
Overview when nothing is pending) renders the full prompt for your idea, stack
and scope (`POST /api/prompts/idea-to-mvp`). Copy it and paste it into Claude
Code as a message, or copy the `claude '…'` command line. Don't type the idea
after the slash command: Claude Code splits slash-command arguments on spaces,
so only the first word would arrive.

`task_create_batch` creates up to 50 tasks at once; each item may carry a
`ref` label and `dependsOn` (refs in the batch or existing ids). The whole
batch is validated before anything is written.

## Connect Claude Code

```bash
agentboard connect .
```

Registers the AgentSprint MCP server in `./.mcp.json` (keeping any other
servers) and a `SessionStart` hook in `.claude/settings.local.json` that runs
`agentboard context`, so every new, resumed, cleared or compacted session
starts with the project brief. Restart Claude Code in the folder and approve
the `agentsprint` server.

## Never lose the thread

- **Start:** the brief (`agentboard context`, `project_context`, the
  `resume` prompt) shows the active sprint, work in progress with its last
  note, what waits for review, the next unblocked tasks, blockers, the last
  handoff and recent learnings.
- **End:** `session_handoff` (or `agentboard handoff`, or the Overview's
  *Write handoff*) appends what was done, what is next and what blocks to
  `.agentboard/journal.md`, an append-only log that lives in git with the code.

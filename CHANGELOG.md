# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] — 2026-10-22

Everything below reaches npm for the first time: 0.1.0 shipped without
`connect`, `context`, handoffs, agents or the review gate.

### Added
- **Approve from the chat**: the `review-assistant` agent (read-only) and the `human-review` MCP prompt. The main session reads `review_queue`, can ask `review-assistant` for a decision brief per task, asks you in batches of up to 4 multiple-choice questions, records your answers with `review_decide`, and closes a sprint only when you choose to. `agentboard agents sync` installs the agent.
- **Parallel safety in dispatch**: tasks can declare `files:` (validated by lint), and same-wave tasks that share files or a package area are flagged (`⚠ shares … with TK-x`, `conflicts` in JSON) with a hint to use a worktree or separate waves. The review gate skips tasks whose approval is newer than their last change and lists them as already approved (`review[].approvedBy`).
- **Human review queue**: `buildReviewQueue` and `ProjectStore.decideReview` in core. The review rules moved here from the web and are also available as `@jmrojas06/agentsprint-core/review`. Plus the MCP tools `review_queue` / `review_decide`, `GET /api/review-queue` and `agentboard review [--sprint] [--json] [--done ids] [--changes id --finding x]`.
- `agentboard task <claim|release|status|note|check|review|show> <dir> <id> [--agent <name>]` runs the task workflow without MCP. It uses the same store calls, locks, activity and errors as the `task_*` tools. Generated subagents now fall back to it instead of hand-editing task files. An empty `--agent` counts as missing (so no lock is ever taken with an empty owner), an empty note is refused, and ids are validated, so a path cannot reach outside `.agentboard/tasks/`.
- **Start from an idea**: a dialog, opened from the command palette or from the Overview when there is no active sprint or nothing pending. It copies the full Idea → MVP prompt, to paste into Claude Code as a message, or the `claude` command line that sends it. It does not use the slash command, because Claude Code splits slash-command arguments on whitespace. It links the Idea → MVP docs and lists the tasks as they land on the board. The prompt text has one source, shared by the MCP prompt and the new `POST /api/prompts/idea-to-mvp`. The README no longer suggests typing a multi-word idea after the slash command.
- **Approve from the UI**: tasks in Review get *Mark done* and *Request changes* (findings required, recorded as reviewer `user`), both in Overview rows and in the task modal, which also shows the latest verdict. *Close approved (N)* moves every task approved since its last change to Done, after a confirmation.
- `agentboard doctor [dir] [--url <url> ...] [--json]` checks the environment: board lint, orphaned locks and file ownership, a stale local `dist`, each server's build commit against HEAD (`-dirty` means a modified tree) and the `.mcp.json` agentsprint entry. It exits 1 on errors.
- **Session continuity**: `agentboard context`, the `project_context` MCP tool, the `resume` prompt and `GET /api/context` render a brief of where the project is (sprint progress, work in flight with its last note, review queue, next unblocked tasks, blockers, recently done, last handoff, recent learnings). Handoffs go to an append-only `.agentboard/journal.md` via `session_handoff`, `agentboard handoff`, `POST /api/journal` or the UI. The MCP server sends instructions to start and end every session with them, and `agentboard connect` installs a Claude Code `SessionStart` hook that injects the brief.
- **Skills in agent profiles**: `skills` (preloaded Claude Code skills) and `disallowedTools` in `.agentboard/agents/*.md`, rendered into `.claude/agents/`. Default agents name the skills that help and use installed ones on demand (see Changed). `agentboard skills`, `skill_list` and `GET /api/skills` show installed and missing skills.
- **Review gate**: read-only `code-reviewer` and `ui-reviewer` agents with their own protocol; `task_review` (MCP) and `POST /api/tasks/:id/review` record `approve` or `changes` (findings, back to In Progress) as a note and a `review` activity event. `sprint_dispatch` names the reviewer per task and lists a Review gate section.
- **Overview** view (new default): sprint progress, in progress, waiting for review with verdict badges, ready next, blocked, last handoff, journal, *Copy brief* and *Write handoff*.
- **Specialized agents** in `.agentboard/agents/` (developer, designer, tester, fixer, docs, creative-director, ideator) with `tools` / `model` options. A task assigned to one gets its prompt injected into the spec and keeps that assignee across status changes; `agentboard lint` flags unknown assignees and broken profiles.
- **Real Claude Code subagents**: every agent is mirrored to `.claude/agents/<name>.md` with the board protocol appended, on init, on every agent change and while the server runs. Hand-written subagents are never overwritten; opt out with `subagents: false`.
- **Dispatch plan**: `sprint_dispatch` (MCP), `agentboard dispatch`, `GET /api/dispatch` and the **Run sprint** button split a sprint into waves of parallel tasks with the subagent for each one.
- **Idea → MVP**: `idea-to-mvp` and `run-sprint` MCP prompts; `task_create_batch` (MCP) / `POST /api/tasks/batch` create a linked plan in one validated call.
- Agent management everywhere: `agent_upsert` / `agent_delete` / `agent_sync` MCP tools, `/api/agents` CRUD + sync, `agentboard agents [sync]`, and an **Agents** tab in the UI (view prompts, create, edit, delete, sync).
- `agentboard connect` registers the MCP server in `.mcp.json`; `agentboard mcp` runs it over stdio.
- The UI shows specialist assignees with their color, groups the assignee pickers (workflow roles vs. specialists) and adds "Run sprint" to the command palette.

### Changed
- **Agents preload no skills.** The default profiles drop `skills:`: each prompt names the skills that help at each step and the subagent invokes the installed ones with the Skill tool when it needs them. Preloading injected every listed skill in full at each launch, used or not, which measured about 9k tokens for `developer` and about 28k for `designer` and `ui-reviewer` before they read any code. `skills:` still works for a skill an agent must always have. Existing boards keep their profiles; delete the `skills:` lines to get the same savings. The suggestions no longer name skills without a public source.
- **A new board asks for the real project.** The getting-started examples are all tagged `getting-started` and none starts In Progress (TK-2 used to, while its dependency TK-1 was still To Do). While they are the only tasks, the brief adds a *New board* section telling the agent to ask what the user is building instead of resuming the tutorial.
- Quick start rewritten for Claude Code: `init` + `connect`, the first session, light (`resume`) vs. full (`run-sprint`) runs and what each costs. `docs/agents.md` documents where the suggested skills come from and how to add your own agents.
- UI polish: Geist type, calibrated near-black and light themes with one indigo accent, a two-row header (navigation and filters), flexible board columns, a collapsible side panel, quieter task cards, skills editing in the Agents tab, review gate in Run sprint, global focus rings and reduced-motion support.
- README rewritten around the session workflow with real screenshots and a new demo tour.
- `agentboard lint` exits 0 when only warnings are found.
- `task_claim` records the claiming agent as the activity actor and, when it is a specialist, as the assignee.
- `sprint_dispatch` no longer sends a pending task without acceptance criteria to a subagent: it is listed as blocked (`no acceptance criteria — add them before dispatching`) and its dependents wait on it. `agentboard lint` warns `NO_ACCEPTANCE_CRITERIA` for such tasks (lint now reads criteria from the task body).
- MCP write tools (`task_create`, `task_update`, `task_status`, `task_claim`, `task_checklist`, `task_note`, `task_review`) return a compact task — the last 3 activity events plus `activityCount` — and `learnings_append` returns `{ ok: true, entry }` instead of the whole file. `task_get` and `task_list` still return the full task.
- Git commit caches take a configurable TTL (`gitCacheTtlMs` / `AGENTBOARD_GIT_CACHE_TTL_MS`, default 10s, `0` disables), are cleared on every board change and drop expired entries on write.


### Fixed
- `agentboard connect` run through `npx` wrote paths into npx's cache (`~/.npm/_npx/<hash>/…`) into `.mcp.json` and the SessionStart hook; once npm cleared or replaced that cache, the MCP server and the brief stopped working without a message. It now writes `npx -y @jmrojas06/agentsprint-cli@<version>` (`cmd /c npx …` on Windows). Global installs and checkouts keep their path.
- Generated subagents carry a protocol schema in their marker (`agentsprint:generated schema=N`). An older AgentSprint, such as a stale Docker image, no longer rewrites subagents generated by a newer one back to an old protocol: it skips them and logs it once. Files without a schema count as schema 0 and are upgraded. `agentboard doctor` warns when `.claude/agents` is newer than the running binary. A fingerprint test fails whenever the generated text changes without a schema bump. Schema 2 makes the review assistant read-only by tools whatever its profile says.
- `GET /api/tasks/:id/commits` returned every full commit hash except the first with a leading newline. git log records are now NUL-separated with `-z`.
- Docker: the image runs as the `node` user (uid 1000) instead of root, so files it writes in mounted repos stay owned by you. It ships `git`, so commit links work, and it runs under `tini`. `.dockerignore` excludes nested `node_modules` and `dist`. `pnpm docker:up` rebuilds the image from the checkout and stamps it with the commit.
- `GET /api/health` returns `{ version, commit, builtAt }`, and `agentboard serve` prints the build at startup, so an old server (a stale image or `dist`) is easy to spot.
- A skipped task file now says why: the failing field (with a hint that the server may be older than whoever wrote the file) or the YAML error. Before, every failure blamed unquoted `": "` in titles.
- `index.html` is served with `Cache-Control: no-cache` (hashed assets stay cached for a year), so an upgraded UI shows up immediately instead of after an hour.
- The header wraps on narrow screens instead of pushing search and actions off-screen.
- Below 1024px the Sprints, Agents and Brand panel opens as a drawer from the header (focus trapped, Escape closes); the command palette can open Agents, Sprints and the brand kit.
- The Run sprint dialog takes focus on open, keeps Tab inside and returns focus when closed; on phones its titles wrap instead of being cut.
- Secondary text and primary-button hover meet WCAG AA contrast in both themes. The Overview sprint bar shows completion, phone rows move badges to a second line, Write handoff scrolls to and focuses its form, header icon buttons have accessible names and skill-remove buttons are 24px targets.
- Task ids are allocated under a board-wide file lock: two processes creating tasks at once no longer get the same id and overwrite each other's file. Creating a task over an existing file now fails.
- `task_claim` / `lockTask` / `unlockTask`, checklist toggles, dependency checks and deletes read the task from disk inside the per-file lock, so a claim held by an agent in another process is respected and stale copies no longer overwrite newer edits.
- The stdio MCP server re-syncs with `.agentboard/` before every tool call (incremental, by file stamp): edits by other agents or by hand are visible without a restart.
- Tasks without acceptance criteria no longer reload with a phantom `## Activity` criterion; checkboxes in the description or notes are no longer read as criteria.
- MCP tool failures are flagged with `isError: true` and return a JSON `{ "error" }` body.
- The stdio MCP server writes `[agentboard mcp] exiting: <reason>` on every exit: stdin closed, a signal, or an uncaught error. Any tool or board re-sync exception becomes an `isError` result instead of ending the process. Before, a SIGINT from the client ended it silently and no one could tell why the tools disappeared. A closed stdin still lets in-flight responses finish, and a signal still ends the process by that signal.
- File write locks left by a crashed or killed writer are recovered: locks record the owner pid, host and time, stale ones are reclaimed, and a holder that lost its lock while suspended never deletes the new owner's lock. Before, one killed process blocked every later write to that file. `.agentboard/**/*.lock` and `*.tmp` are git-ignored.
- The session brief, task specs ("Learned principles") and the sprint-planning prompt no longer paste the task lists of automatic sprint retros; new retros nest their headings under a single `##` section.
- A status change that echoes the unchanged assignee (as the web task modal does) still applies the status → assignee mapping.
- Reviewer routing matches the `ideas`, `creative` and `reviewer` agent tags regardless of case.
- Sprint creation and updates run under a board-wide lock with a fresh read from disk. Before, two processes could get the same sprint id (4 processes creating 8 sprints each left 17 of 33 files) or undo each other's edits. Every activity actor is sanitized to one line without `|`.
- The side panel and command palette show which server build the UI is talking to (version, commit and build time from `/api/health`), and the parse-warnings banner shows each file's own reason.
- Dialogs share a focus stack: only the top one reacts to Tab and Escape, so a token prompt over the side drawer or a task modal keeps focus and Escape never discards the modal's edits (task modals join the stack for Escape too). Icon-only close and dismiss buttons have accessible names. Below 1024px "Clear saved token" lives in the side drawer.
- A save, create or delete refused after dismissing the token prompt shows an inline message and keeps your edits. Focus returns to the card or row that opened a task, or to its neighbour when the task left the list. Review decisions taken from the task modal are announced. "Token rejected" meets 4.5:1 contrast in both themes.
- The task modal and the New task modal are real dialogs (`role="dialog"`, a name, focus moved in on open, Tab kept inside), and every field is labelled. Close approved shows a warning icon when some tasks failed, and the task modal footer stays on one line at 375px.
- The command palette is a modal combobox: focus stays in the search field, the arrow keys move through the options (announced with `aria-activedescendant`), and Tab no longer escapes behind it.
- Opening another task while one is open (from the palette) now shows that task. Before, the form kept the first task's edited fields, and saving wrote them over the second task.
- Overview task rows size to their column (container queries), so titles stay readable next to the side panel on mid-size screens.
- Token auth in the UI: any 401 opens one token prompt (labelled, focused) that re-sends the refused requests, rejects a wrong token instead of storing it, keeps the board on screen when a change is refused, and streams live updates with the bearer token under `--token-all` (the token never goes in a URL). One Cancel on a `--token-all` board goes straight to "Enter token".

### Security
- The server rejects browser requests from foreign origins (CSRF) and, when bound to loopback, requests with a foreign `Host` header (DNS rebinding). New `--allowed-host` / `--allowed-origin` options (env `AGENTBOARD_ALLOWED_HOSTS` / `AGENTBOARD_ALLOWED_ORIGINS`) for exposed setups, plus startup warnings when bound to a non-loopback address without them or without `--token`.
- Note author and reviewer names are collapsed to one line, so they cannot inject headings into a task or break its activity log.
- `agentboard connect` shell-quotes the SessionStart hook command: project paths with `$`, backticks or quotes no longer expand.

## [0.1.0] — initial release

### Added
- Git-native board storage (`.agentboard/` Markdown + YAML frontmatter)
- Kanban UI with configurable workflow columns
- Sprint management: create, activate, close, stats and burndown
- Tasks with description, acceptance criteria checklists, priority, estimate,
  tags, dependencies, notes, `human`/`agent` assignee
- Dependency graph with cycle detection and blocking awareness
- Interactive acceptance-criteria checkboxes with live SSE sync
- Visual dependency badges (`Blocked by N` / `Ready`) on cards and modal
- Multi-criteria filtering (priority / assignee / tag) plus per-column sorting
- Task spec export with brand-kit and learnings injection
- Brand kit editor (identity, colors, fonts, assets, guidelines)
- Persistent learnings memory (`.agentboard/learnings.md`)
- MCP server: stdio (`agentboard-mcp`) and Streamable HTTP (`serve --mcp`)
- REST API + SSE real-time sync + file watcher
- SQLite-backed search index with in-memory fallback
- Board integrity linter (`agentboard lint`)
- Port fallback with `--no-fallback` opt-out
- Docker image with healthcheck + docker-compose setup
- CI (typecheck/test/build) and automated npm publish + GHCR Docker push

[Unreleased]: https://github.com/jmrojas06/AgentSprint/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jmrojas06/AgentSprint/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jmrojas06/AgentSprint/releases/tag/v0.1.0

# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Session continuity**: `agentboard context`, the `project_context` MCP tool, the `resume` prompt and `GET /api/context` render a brief of where the project is (sprint progress, work in flight with its last note, review queue, next unblocked tasks, blockers, recently done, last handoff, recent learnings). Handoffs go to an append-only `.agentboard/journal.md` via `session_handoff`, `agentboard handoff`, `POST /api/journal` or the UI. The MCP server sends instructions to start and end every session with them, and `agentboard connect` installs a Claude Code `SessionStart` hook that injects the brief.
- **Skills in agent profiles**: `skills` (preloaded Claude Code skills) and `disallowedTools` in `.agentboard/agents/*.md`, rendered into `.claude/agents/`. Default agents preload matching skills; the designer loads every design skill. `agentboard skills`, `skill_list` and `GET /api/skills` show installed and missing skills.
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
- UI polish: Geist type, calibrated near-black and light themes with one indigo accent, a two-row header (navigation and filters), flexible board columns, a collapsible side panel, quieter task cards, skills editing in the Agents tab, review gate in Run sprint, global focus rings and reduced-motion support.
- README rewritten around the session workflow with real screenshots and a new demo tour.
- `agentboard lint` exits 0 when only warnings are found.
- `task_claim` records the claiming agent as the activity actor and, when it is a specialist, as the assignee.


### Fixed
- `index.html` is served with `Cache-Control: no-cache` (hashed assets stay cached for a year), so an upgraded UI shows up immediately instead of after an hour.
- The header wraps on narrow screens instead of pushing search and actions off-screen.
- Task ids are allocated under a board-wide file lock: two processes creating tasks at once no longer get the same id and overwrite each other's file. Creating a task over an existing file now fails.
- `task_claim` / `lockTask` / `unlockTask`, checklist toggles, dependency checks and deletes read the task from disk inside the per-file lock, so a claim held by an agent in another process is respected and stale copies no longer overwrite newer edits.
- The stdio MCP server re-syncs with `.agentboard/` before every tool call (incremental, by file stamp): edits by other agents or by hand are visible without a restart.
- Tasks without acceptance criteria no longer reload with a phantom `## Activity` criterion; checkboxes in the description or notes are no longer read as criteria.
- MCP tool failures are flagged with `isError: true` and return a JSON `{ "error" }` body.

### Security
- The server rejects browser requests from foreign origins (CSRF) and, when bound to loopback, requests with a foreign `Host` header (DNS rebinding). New `--allowed-host` / `--allowed-origin` options (env `AGENTBOARD_ALLOWED_HOSTS` / `AGENTBOARD_ALLOWED_ORIGINS`) for exposed setups, plus startup warnings when bound to a non-loopback address without them or without `--token`.

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

[Unreleased]: https://github.com/jmrojas06/AgentSprint/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jmrojas06/AgentSprint/releases/tag/v0.1.0

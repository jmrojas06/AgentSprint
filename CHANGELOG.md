# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
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

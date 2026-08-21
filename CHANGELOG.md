# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/agentsprint/agentsprint/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agentsprint/agentsprint/releases/tag/v0.1.0

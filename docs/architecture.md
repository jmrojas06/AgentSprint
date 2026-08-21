# Architecture

AgentSprint is a pnpm monorepo with five packages that depend on each other in a DAG:

```
packages/
├── core/    → domain model + git-native storage (.agentboard/*.md)
├── server/  → Fastify: REST + SSE + file watcher + SQLite index (depends on core, mcp)
├── web/     → React + Vite + Tailwind board UI                    (depends on core)
├── cli/     → the `agentboard` CLI (init / serve / spec / brand)  (depends on core, server, web)
└── mcp/     → MCP server so agents read/claim/complete tasks      (depends on core)
```

## Data flow

1. Tasks live as `.md` files in `.agentboard/tasks/` with YAML frontmatter.
2. `core/ProjectStore` reads/writes these files and emits `change` events.
3. `server/` wraps `ProjectStore` with a Fastify REST API + SSE stream and watches the filesystem (`chokidar`).
4. `web/` is a React SPA that fetches via REST and listens to SSE for live updates.
5. `cli/` is the entry point: `agentboard serve` starts the server and serves the built SPA.
6. `mcp/` reuses the same `ProjectStore` to expose MCP tools over stdio or Streamable HTTP.

## Storage model

All storage is file-based — **no database server is required**:

```text
your-project/
├── .agentboard/
│   ├── config.yaml           ← workflow: columns & statuses
│   ├── brand.md              ← company/brand kit
│   ├── memory.md             ← persistent learnings
│   ├── tasks/TK-1.md         ← one task = one Markdown file
│   └── sprints/sprint-1.md   ← sprint goal + state
└── AGENTS.md                 ← tells any agent how to work here
```

- Task status lives in the YAML frontmatter of each file, so `git log` is your audit trail.
- SQLite (`node:sqlite`, no native compilation) is used only for full-text search indexing, with an automatic in-memory fallback.
- The file watcher makes direct edits and UI edits converge: whichever changes first, the other side updates within milliseconds.

## Design principles

1. **The files are the API.** Anything that can read/write Markdown can participate — agents, scripts, editors.
2. **Human owns Done.** Agents move tasks to *Review*; only you move them to *Done*.
3. **One task at a time.** Agents claim a single task, keeping context small and reviewable.
4. **Local-first.** Everything runs on `127.0.0.1`; nothing leaves your machine unless you push to git.

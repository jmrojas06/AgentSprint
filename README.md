# AgentSprint

**Git-native sprint board for solo developers who code with AI agents.**

AgentSprint is a self-hosted, local-first board where *your* tasks live as
plain Markdown files inside your repository — and your AI coding agent
(opencode, Claude Code, Cursor, …) works through them in sprints, right
alongside you.

No accounts. No cloud. No lock-in. Your board is a folder in git.

```
your-project/
├── .agentboard/              ← the board lives in your repo
│   ├── config.yaml           ← workflow: columns & statuses
│   ├── brand.md              ← company/brand kit (injected into task specs)
│   ├── tasks/TK-1.md         ← one task = one Markdown file
│   ├── sprints/sprint-1.md   ← sprint goal + state
└── AGENTS.md                 ← tells any agent how to work here
```

## Why

AI coding agents are great at executing but forget between sessions. A
`TODO.md` or a single chat context doesn't survive a context limit, a reboot,
or a different agent. AgentSprint gives agents (and you) a **shared, durable,
human-readable board** with real sprint semantics:

1. You write tasks and plan a sprint in the visual hub.
2. The agent reads `.agentboard/` and works one task at a time, updating
   `status` in the file as it goes.
3. Finished tasks land in **Review** — *you* move them to Done.
4. Close a sprint, plan the next. Progress is in git, forever.

## Quick start

### Option 1: npx (no install, stays in sync with npm)

```bash
# inside any project you want to manage
npx agentboard init        # scaffolds .agentboard + sample tasks + AGENTS.md
npx agentboard serve       # starts the board UI at http://127.0.0.1:4310
```

> Requires Node.js >= 20. The first run downloads the package on demand.

### Option 2: Global install

```bash
npm install -g @agentsprint/cli
agentboard init my-project
agentboard serve my-project
```

### Option 3: Docker

```bash
docker build -t agentsprint .
docker run -d --name board --restart unless-stopped \
  -p 4310:4310 \
  -v "$PWD":/board \
  agentsprint serve /board --host 0.0.0.0 --no-open --mcp
```

See [Docker deployment](#docker-deployment) and [docker-compose.yml](docker-compose.yml) for more.

### Option 4: From source

```bash
git clone https://github.com/agentsprint/agentsprint.git
cd agentsprint
pnpm install
pnpm build
pnpm agentsprint init demo-project
pnpm agentsprint serve demo-project
```

## Installation

AgentSprint runs on Node.js 20+ and works on Linux, macOS, and Windows.

| Method | Command | Notes |
|--------|---------|-------|
| npx (no install) | `npx agentboard init` | Downloads automatically |
| npm | `npm i -g @agentsprint/cli` | Global binary `agentboard` |
| pnpm | `pnpm add -g @agentsprint/cli` | Global binary `agentboard` |
| Docker | `docker run -p 4310:4310 …` | No Node.js needed |
| From source | `pnpm build && pnpm agentsprint …` | Latest dev features |

### System requirements

- Node.js >= 20
- pnpm >= 9 (only if installing from source)
- Docker (only if running the container image)

## CLI reference

```
agentboard [command] [dir]

Commands:
  init [dir]        Scaffold a board in the directory (default: current dir)
  serve [dir]       Start the server + UI (default command)
  spec <dir> <id>   Print the agent prompt (spec) for a task, e.g. TK-1
  brand [dir]       Print the company/brand kit for the project
  lint [dir]        Check board integrity (YAML, IDs, sprints, deps)
  help              Show help

Options:
  --port <n>        Port to listen on (default: 4310)
  --host <ip>       Host to bind (default: 127.0.0.1)
  --no-open         Do not open the browser automatically
  --no-fallback     Disable auto port fallback if port is busy
  --init            Auto-create a board if missing (serve)
  --mcp             Also expose MCP tools at /mcp (streamable HTTP)
  --version         Print the version
```

When the default port (4310) is busy, AgentSprint automatically tries the
next available port. Use `--no-fallback` to disable this and fail fast
with `EADDRINUSE` instead.

## Using it with an AI agent

The `.agentboard/` files are the API. Any agent that can read and edit files
can participate — just point it at your repo and it follows `AGENTS.md`.

- **One task = one file.** Status lives in the YAML frontmatter:
  `status: To Do` → `status: In Progress` → `status: Review` → `status: Done`.
- **Sprints are files too.** Activate one from the UI or by editing
  `sprints/sprint-1.md`.
- **MCP server.** A native MCP server (`agentboard-mcp`) lets agents claim
  tasks, list boards, and grab a task's spec through tools. See `docs/mcp.md`.
- **MCP over HTTP.** `agentboard serve --mcp <dir>` exposes the same MCP tools
  at `http://<host>:4310/mcp` (Streamable HTTP) on the same server as the UI —
  any MCP client connects by URL, no extra process. Configure opencode with
  `{ "mcp": { "agentsprint": { "type": "remote", "url": "http://127.0.0.1:4310/mcp" } } }`.
- **Spec export.** One click (or `agentboard spec <dir> TK-1`) turns a task
  into a self-contained prompt your agent can execute.
- **Brand kit.** Configure your company identity, colors, fonts and design
  files in `brand.md` — they get injected into every task spec so agents
  follow your brand.

## Docker deployment

Run the board (UI + `/mcp`) in a container that restarts automatically.
Build locally, or pull the published image once a release exists
(`ghcr.io/agentsprint/agentsprint`):

```bash
docker build -t agentsprint .
docker run -d --name board --restart unless-stopped \
  -p 4310:4310 \
  -v "$PWD/your-project:/board" \
  agentsprint serve /board --host 0.0.0.0 --no-open --mcp
```

For self-hosted multi-project setups, use `docker-compose.yml`:

```bash
# Edit docker-compose.yml to point at your project directories
docker compose up -d
```

The container exposes port 4310, includes a health check (`/api/health`),
and reads board data from `/board` (mount any host path there).

## Features

- Kanban board with configurable columns (`config.yaml`)
- Sprint management: plan, activate, close; task counts, progress bars and
  per-sprint stats
- Tasks with description, acceptance criteria, priority, estimate, tags,
  dependencies, and a `human`/`agent` assignee
- Spec export (`buildTaskSpec`) with automatic brand-guideline injection
- Brand kit editor (identity, color pickers, fonts, design assets, rules)
- Real-time sync: edit files directly and the board updates instantly
  (file watcher), or click the board and files are written for you
- Fast search over tasks via a SQLite index (zero native deps — built on
  Node's `node:sqlite`, with an in-memory fallback)
- MCP server so AI agents can read/claim/complete tasks via tools
- MCP over Streamable HTTP (`serve --mcp`) on the same port as the UI
- Parse warnings surfaced in `/api/project` and `board_summary`
- SPA served by the same server; also runs with `vite dev` for hacking

## Architecture

AgentSprint is a pnpm monorepo with five packages that depend on each other
in a DAG:

```
packages/
├── core/    → domain model + git-native storage (.agentboard/*.md)
├── server/  → Fastify: REST + SSE + file watcher + SQLite index  (depends on core, mcp)
├── web/     → React + Vite + Tailwind board UI                  (depends on core)
├── cli/     → the `agentboard` CLI (init / serve / spec / brand) (depends on core, server)
└── mcp/     → MCP server so agents read/claim/complete tasks     (depends on core)
```

**Data flow:**
1. Tasks live as `.md` files in `.agentboard/tasks/` with YAML frontmatter.
2. `core/ProjectStore` reads/writes these files and emits `change` events.
3. `server/` wraps `ProjectStore` with a Fastify REST API + SSE stream.
4. `web/` is a React SPA that fetches via REST and listens to SSE for live updates.
5. `cli/` is the entry point: `agentboard serve` starts the server + serves the UI.
6. `mcp/` reuses the same `ProjectStore` to expose MCP tools (local stdio + HTTP).

All storage is file-based. No database server is required — SQLite is used
only for full-text search indexing with an in-memory fallback.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.
In short:

```bash
git clone https://github.com/agentsprint/agentsprint.git
cd agentsprint
pnpm install
pnpm typecheck
pnpm test
```

Contributions are welcome! Please:
1. Fork the repo and create a feature branch
2. Run `pnpm typecheck && pnpm test` before opening a PR
3. Keep PRs focused — one feature or fix per PR
4. Update tests and docs alongside code changes

## Troubleshooting

### Port 4310 already in use

AgentSprint automatically falls back to the next free port (4311, 4312, …).
To force a specific port, use `--port <n>`. To disable fallback:

```bash
agentboard serve --port 4310 --no-fallback
```

If running in Docker and you get a port conflict, map a different host port:

```bash
docker run -p 4311:4310 ghcr.io/agentsprint/agentsprint serve /board
```

### "No AgentSprint board found"

Run `agentboard init <dir>` first to scaffold `.agentboard/` with sample content.

### File watcher not picking up changes

Ensure your file system is not in a container without volume mounts.
The watcher uses `chokidar` and respects `.gitignore`-like patterns.

### MCP tools show "connection refused"

Make sure `agentboard serve --mcp` is running, then verify the MCP URL:
`http://127.0.0.1:4310/mcp`. Check your MCP client configuration matches.

The initial `pnpm build` compiles all five TypeScript packages. Subsequent
builds are faster with `pnpm dev` (watch mode).

## Roadmap

- [x] Git-native storage, domain model, REST API, kanban board
- [x] MCP server — agents read/claim/complete tasks via tools
- [x] Spec export: turn a task into a ready-made agent prompt
- [x] Brand kit: company identity injected into task specs
- [x] Interactive checklists, dependency badges, active filters & sorting
- [x] Persistent learnings memory with spec injection
- [x] Docker image, docker-compose, port fallback
- [x] npm publishing + CI/CD release workflow
- [ ] Sprint engine polish: burndown, velocity, retro notes
- [ ] Review gates, dependencies graph, activity log
- [ ] Plugin system for custom task sources
- [ ] Web component library for embedding boards

## License

MIT

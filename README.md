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

```bash
# inside any project you want to manage
npx agentboard init        # scaffolds .agentboard + sample tasks + AGENTS.md
npx agentboard serve       # starts the board UI at http://127.0.0.1:4310
```

Or run from source:

```bash
pnpm install
pnpm build
pnpm agentsprint init demo-project
pnpm agentsprint serve demo-project
```

## Using it with an AI agent

The `.agentboard/` files are the API. Any agent that can read and edit files
can participate — just point it at your repo and it follows `AGENTS.md`.

- **One task = one file.** Status lives in the YAML frontmatter:
  `status: To Do` → `status: In Progress` → `status: Review` → `status: Done`.
- **Sprints are files too.** Activate one from the UI or by editing
  `sprints/sprint-1.md`.
- **MCP server (roadmap).** A native MCP server is planned so agents can
  claim tasks and report progress through tools instead of raw file edits.

## Features

- Kanban board with configurable columns (`config.yaml`)
- Sprint management: plan, activate, close; task counts per sprint
- Tasks with description, acceptance criteria, priority, estimate, tags,
  dependencies, and a `human`/`agent` assignee
- Real-time sync: edit files directly and the board updates instantly
  (file watcher), or click the board and files are written for you
- Fast search over tasks via a SQLite index (zero native deps — built on
  Node's `node:sqlite`, with an in-memory fallback)
- SPA served by the same server; also runs with `vite dev` for hacking

## Development

```bash
pnpm install
pnpm typecheck   # all packages
pnpm test        # core + server tests
pnpm build       # build all packages
pnpm dev         # watch-build all packages
```

```
packages/
├── core/    # domain model + git-native storage (.agentboard/*.md)
├── server/  # Fastify: REST + SSE + file watcher + SQLite index
├── web/     # React + Vite + Tailwind board UI
└── cli/     # the `agentboard` CLI (init / serve)
```

## Roadmap

- [x] Git-native storage, domain model, REST API, kanban board
- [ ] Sprint engine polish: burndown, velocity, retro notes
- [ ] **MCP server** — agents read/claim/complete tasks via tools
- [ ] Spec export: turn a task into a ready-made agent prompt
- [ ] Review gates, dependencies graph, activity log
- [ ] npm publishing + Docker image + docs site

## License

MIT

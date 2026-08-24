# AgentSprint

> Kanban git-native para coordinar devs y agentes de IA en el mismo repositorio.

[![CI](https://github.com/jmrojas06/AgentSprint/actions/workflows/ci.yml/badge.svg)](https://github.com/jmrojas06/AgentSprint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jmrojas06/agentsprint-cli.svg)](https://www.npmjs.com/package/@jmrojas06/agentsprint-cli)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Fjmrojas06%2Fagentsprint-2496ED.svg)](https://ghcr.io/jmrojas06/agentsprint)
[![Docs](https://img.shields.io/badge/docs-github%20pages-blue)](https://jmrojas06.github.io/AgentSprint/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

<p align="center">
  <a href="docs/public/demo-v2.mp4">
    <img src="docs/public/demo-v2.gif" alt="AgentSprint demo" width="800">
  </a>
</p>

<details open="block">
  <summary>Ver demo en video (45 seg)</summary>

  **Español:** [docs/video-storyboard.md](docs/video-storyboard.md) — Storyboard y guion para video de 45 segundos.
  **English:** [docs/video-storyboard.md](docs/video-storyboard.md) — Storyboard and 45-second demo script.

  *Para generar el video:*
  - Grabación automática: `npm run demo:mp4` genera `docs/public/demo-v2.mp4`.
  - Preview GIF: `npm run demo:gif` genera `docs/public/demo-v2.gif` (8 s, 480×270).
  - Herramienta: ffmpeg (instalado en CI via `apt-get install ffmpeg`).
  - Overlays: usar el guion en `docs/video-script-es.md`.

  <br>
  *Video generado:* pipeline automático — los archivos `demo-v2.mp4` y `demo-v2.gif` se producen en el workflow de GitHub Actions.

  - **MP4:** demo completa (45 s, 1920×1080, 30 fps) — [docs/public/demo-v2.mp4](docs/public/demo-v2.mp4)
  - **GIF:** preview corto (8 s, 480×270, 15 fps) — [docs/public/demo-v2.gif](docs/public/demo-v2.gif)

  <br>
  *Los archivos se generan en el workflow de docs.yml y se publican en GitHub Pages.*
</details>

Documentation · [Issues](https://github.com/jmrojas06/AgentSprint/issues) · [Changelog](CHANGELOG.md)

## Why AgentSprint

Los agentes de IA son buenos ejecutando trabajo pero olvidan entre sesiones. El contexto de un chat muere con la ventana de contexto; un `TODO.md` no tiene sprints, ni criterios de aceptación, ni historia versionada.

AgentSprint mantiene el trabajo donde vive el código:

- Las tareas son archivos Markdown con YAML en `.agentboard/` — no en la nube de alguien más.
- Cada tarea es un archivo Markdown con frontmatter, legible por humanos y agentes.
- Los cambios de status son ediciones de texto plano, por lo que el historial de Git se convierte en historial del tablero — revisable en pull requests, difable y restaurable.
- Los agentes participan mediante MCP o editando archivos directamente; tú revisas y decides qué está hecho.

**No hay cuentas. No hay servidor que mantener. Tu tablero es una carpeta en Git.**

## What AgentSprint gives you

- **Git-native task storage** — one task = one Markdown file under `.agentboard/tasks/`
- **Kanban board** — local web UI with configurable columns, filters, sorting and checklists
- **Sprint management** — plan, activate, close; stats and burndown per sprint
- **Persistent context** — learnings memory and brand kit injected into every task spec an agent receives
- **CLI** — init boards, serve the UI, export specs, lint integrity, import TODOs or GitHub issues
- **MCP server** — stdio and HTTP transports so any MCP-compatible agent can work the board
- **REST API + SSE** — every board operation available programmatically, with live updates
- **File watcher** — edit `.agentboard/` files directly and the UI updates instantly
- **Full-text search** — SQLite-backed index with zero native dependencies
- **Docker** — self-hosted image with health check for always-on setups
- **Port fallback** — automatic port selection if 4310 is busy

## Choose your setup

AgentSprint está dividido en varios paquetes internos, pero los usuarios solo need elegir un punto de entrada: el CLI, el servidor MCP, la imagen Docker o el repositorio source.

| Use case | Recommended entry point |
|---|---|
| Run the board quickly | [CLI](#quick-start-with-the-cli) |
| Connect an AI agent | [MCP server](#connect-an-ai-agent-with-mcp) |
| Run with containers | [Docker](#docker) |
| Modify or contribute | [Source repository](#install-from-source) |

You never install the internal packages (`core`, `server`, `web`) manually — they ship as dependencies of the entry point you pick.

## Quick start with the CLI

Requires Node.js ≥ 20.

```bash
npx @jmrojas06/agentsprint-cli init   # creates .agentboard/ with sample content
npx @jmrojas06/agentsprint-cli serve  # starts the board at http://127.0.0.1:4310
```

What each command does:

- `init` — scaffolds `.agentboard/` (config, sample tasks, sprints, templates) plus an `AGENTS.md` that tells any coding agent how to work here.
- `serve` — starts the local server, serves the Kanban UI and REST API, and watches board files for changes. If port 4310 is busy it automatically picks the next free port.

Prefer a global install so the short `agentboard` binary is on your PATH:

```bash
npm install -g @jmrojas06/agentsprint-cli
agentboard init
agentboard serve
```

Then point your AI coding agent at the repository — it will follow `AGENTS.md`.

## Motion flow: onboarding from zero to agent-powered board

### Profile 1: Dev solo con agentes de IA

Llega por GitHub, lee el hero y entiende el "Why" en segundos. Ve la tabla "Choose your setup" y elige la ruta CLI. Ejecuta `npx @jmrojas06/agentsprint-cli init` y el board queda listo con muestra contenido. Abre la UI en `http://127.0.0.1:4310` y ve `.agentboard/` — tasks, sprints, todo configurado. Configura su agente apuntando al repositorio; el agente leerá `AGENTS.md` y comenzará a reclamar tareas. El flujo completo:

1. `npx @jmrojas06/agentsprint-cli init` — board scaffolded
2. `npx @jmrojas06/agentsprint-cli serve` — UI + API running
3. Agent claims a task → status moves to In Progress
4. Agent ticks acceptance criteria, logs notes
5. Developer reviews, sets Done — Git records code + board together

### Profile 2: Dev que quiere Docker siempre-on

Llega por GitHub y salta directo a la sección Docker. Copia el comando `docker run`, ajusta la ruta al proyecto (`-v /path/to/your-project:/board`), levanta el container. Abre la UI en `http://localhost:4310` y ve que el board ya está inicializado. Añade `--mcp` para exponer `/mcp` y que su agente remoto se conecte. El flujo:

1. `docker run -d --name board --restart unless-stopped -p 4310:4310 -v /path/to/your-project:/board ghcr.io/jmrojas06/agentsprint serve /board --host 0.0.0.0 --no-open --init`
2. Open `http://localhost:4310` for the UI
3. Add `--mcp` to expose `/mcp` for remote agents
4. Agent connects via HTTP stdio and starts claiming tasks

## Agent workflow

Typical loop with a coding agent:

```text
1. Developer runs agentboard init and plans tasks/sprints.
2. Agent reads AGENTS.md and the active sprint.
3. Agent claims a task — status moves to In Progress.
4. Agent works on the codebase, ticking acceptance criteria.
5. Agent moves the task to Review and logs execution notes.
6. Developer reviews, sets Done; Git records code + board together.
```

Humans own *Done*. Agents stop at *Review* — you verify the criteria before work ships.

## CLI reference

| Command | Purpose |
|---|---|
| `agentboard init [dir]` | Scaffold `.agentboard/` with sample content |
| `agentboard serve [dir]` | Start the server, UI and REST API (default command) |
| `agentboard spec <dir> <id>` | Print a self-contained agent prompt for a task |
| `agentboard brand [dir]` | Print the project's brand kit |
| `agentboard lint [dir]` | Check board integrity (YAML, IDs, sprints, dependency cycles) |
| `agentboard close [dir] [id]` | Close a sprint and append a retrospective |
| `agentboard task new [title] [dir]` | Create a task, optionally from a template |
| `agentboard import todo <file>` | Import bullets/checkboxes from a TODO-style Markdown file |
| `agentboard import github <owner/repo>` | Import open GitHub issues via the `gh` CLI |
| `agentboard export md` | Write `BOARD.md`, a static Markdown snapshot |

Details and options: [docs/cli.md](https://jmrojas06.github.io/AgentSprint/cli).

## MCP tools

28 tools are exposed over both transports. Highlights:

| Tool | Purpose |
|---|---|
| `board_summary` | Active sprint, counts per status, completion % |
| `task_list` / `task_get` | Browse and read tasks with filters |
| `task_create` / `task_update` / `task_delete` | Manage tasks |
| `task_claim` / `task_release` | Claim work exclusively (lock with TTL) |
| `task_status` | Move a task across the board |
| `task_checklist` | Tick acceptance criteria |
| `task_note` | Append timestamped execution notes |
| `task_spec` | Get the full copy-pasteable prompt for a task |
| `sprint_activate` / `sprint_close` / `sprint_report` | Drive the sprint lifecycle |
| `brand_get` / `learnings_get` | Read injected project context |

Complete reference: [docs/mcp.md](https://jmrojas06.github.io/AgentSprint/mcp).

## Features

Available today:

- [x] Git-native Markdown tasks with YAML frontmatter
- [x] Kanban UI with configurable columns, filters and sorting
- [x] Interactive acceptance-criteria checklists with live sync
- [x] Sprints: plan, activate, close, stats and burndown
- [x] Dependency graph with cycle detection and blocked-task awareness
- [x] Task spec export with brand-kit and learnings injection
- [x] MCP server (stdio + Streamable HTTP)
- [x] REST API + SSE real-time updates + file watcher
- [x] SQLite full-text search with in-memory fallback
- [x] Board linter, TODO/GitHub issue import, static `BOARD.md` export
- [x] Docker image with health check + docker-compose
- [x] Automatic port fallback (`--no-fallback` to disable)

## Roadmap

- [ ] Velocity charts and retrospectives polish
- [ ] Review gates
- [ ] Plugin system for custom task sources
- [ ] Web component library for embedding boards

## Documentation

Full documentation at **https://jmrojas06.github.io/AgentSprint/**:

- [Installation](https://jmrojas06.github.io/AgentSprint/installation)
- [Quick start](https://jmrojas06.github.io/AgentSprint/quick-start)
- [Task file format](https://jmrojas06.github.io/AgentSprint/task-format)
- [CLI reference](https://jmrojas06.github.io/AgentSprint/cli)
- [MCP server & tools](https://jmrojas06.github.io/AgentSprint/mcp)
- [REST API](https://jmrojas06.github.io/AgentSprint/api)
- [Architecture](https://jmrojas06.github.io/AgentSprint/architecture)
- [Troubleshooting](https://jmrojas06.github.io/AgentSprint/troubleshooting)
- [Video demo](docs/video-storyboard.md) — storyboard y guion para demo de 45 seg.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing and pull request guidelines. In short — fork, branch, and validate with:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## License

[MIT](LICENSE)

## Support the project

If AgentSprint is useful to you:

- Star the repository.
- Try it in a real project.
- Open an issue with feedback.
- Share your workflow.
- Contribute documentation or code.
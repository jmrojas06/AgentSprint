# REST API

The server started by `agentboard serve` exposes a JSON REST API plus an SSE event stream. All endpoints are prefixed with `/api`. When running multiple projects, pass `?project=<name>` (see `GET /api/projects`).

## Authentication (optional)

By default the board is open (no auth) for local development. To protect mutating operations, start the server with a bearer token:

```bash
agentboard serve --token <secret>
# or
AGENTBOARD_TOKEN=<secret> agentboard serve
```

When a token is set, every `POST`/`PUT`/`PATCH`/`DELETE` under `/api/*` and `/mcp` requires:

```
Authorization: Bearer <secret>
```

Without the header, or with a wrong value, the server returns `401 { "error": "Unauthorized" }` and the secret is never logged.

* `GET` routes stay open by default (read-only). To also protect reads, use:

```bash
agentboard serve --token <secret> --token-all
# or AGENTBOARD_TOKEN=<secret> with --token-all
```

With `--token-all`, every `/api/*` and `/mcp` request (including `GET`) needs the header.

Clients:

* **Web UI** — on `401`, a token prompt appears; the token is stored in `localStorage` under `agentsprint-token` and sent on subsequent requests. Use the “Clear token” button to remove it.
* **CLI / MCP** — on `401`, retry with `Authorization: Bearer <token>` or set `AGENTBOARD_TOKEN` / `--token` and restart the server. Example: `curl -H "Authorization: Bearer $AGENTBOARD_TOKEN" http://127.0.0.1:4310/api/tasks`.
* **MCP over HTTP** (`/mcp`) follows the same bearer rule.

## System

### `GET /api/health`

Liveness probe. Returns `{ "ok": true, "version": "0.1.0" }`. When `--token-all` is on, even `/health` requires the bearer token; otherwise it stays public.

## Projects & config

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/projects` | List every project served by this instance |
| `GET /api/project` | Active project + parse warnings |
| `GET /api/config` | Board workflow configuration |
| `PUT /api/config` | Update board configuration |
| `GET /api/brand` | Brand kit for the project |
| `PUT /api/brand` | Update the brand kit |

## Tasks

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/tasks` | List tasks. Filters: `status`, `sprint`, `assignee`, `q` (full-text search) |
| `POST /api/tasks` | Create a task. Returns the created task with its generated id |
| `GET /api/tasks/:id` | Get a single task by id (e.g. `TK-1`) |
| `PUT /api/tasks/:id` | Replace task fields |
| `PATCH /api/tasks/:id/status` | Move a task to a status (`Backlog`, `To Do`, `In Progress`, `Review`, `Done`) |
| `PATCH /api/tasks/:id/checklist` | Check/uncheck an acceptance criterion by index or text |
| `DELETE /api/tasks/:id` | Permanently delete a task |
| `GET /api/tasks/:id/spec` | Self-contained agent prompt for the task |
| `GET /api/tasks/:id/activity` | Activity log for the task |
| `GET /api/tasks/:id/commits` | Git commits referencing the task |
| `POST /api/tasks/:id/review` | Review-gate verdict on a task in `Review`: `{ verdict: "approve" \| "changes", reviewer?, summary?, findings?: string[] }` (`reviewer` defaults to `user`). Records a note plus a `review` activity event; `changes` moves the task back to `In Progress`, `approve` leaves it in `Review` for a human. Returns the updated task. `400` when the verdict is invalid, the task is not in `Review` or `changes` has no findings; `404` when the task does not exist |
| `GET /api/templates` | Task templates |
| `POST /api/tasks/batch` | Create several tasks: `{ tasks: [{ ref?, title, dependsOn?, ... }] }`, validated before any write |

## Agents & dispatch

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/agents` | Specialized agent profiles (also in `GET /api/project` as `agents`) |
| `PUT /api/agents/:name` | Create or update an agent (`description`, `prompt`, `color`, `tags`, `tools`, `disallowedTools`, `skills`, `model`) |
| `DELETE /api/agents/:name` | Delete an agent and its generated subagent |
| `POST /api/agents/sync` | Regenerate `.claude/agents/`; `{ installDefaults: true }` adds missing defaults |
| `GET /api/skills` | Claude Code skills agents can preload: `{ skills: [{ name, description, source: "project" \| "user" }], missing: [{ agent, skill }] }`. `skills` comes from `.claude/skills/` and `~/.claude/skills/` (the project wins on a name clash); `missing` lists skills an agent references that are not installed |
| `GET /api/dispatch` | Subagent dispatch plan (`plan` JSON + `markdown`); `?sprint=<id>` for a specific sprint |

## Sprints

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/sprints` | All sprints with their status (`planned` / `active` / `closed`) |
| `POST /api/sprints` | Create a sprint |
| `PATCH /api/sprints/:id` | Update, activate, or close a sprint. Activating one demotes any other active sprint to `planned` |
| `GET /api/sprints/:id/stats` | Completion stats: task counts per status, total points and completion percentage |
| `GET /api/sprints/:id/burndown` | Burndown series |
| `GET /api/sprints/:id/report` | Sprint report |

## Session continuity

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/context` | Where the project is: `{ markdown, snapshot, journal }`. `markdown` is the same brief as `agentboard context` and the `project_context` MCP tool; `snapshot` is its structured form (`sprint`, `stats`, `inProgress`, `review`, `next`, `blocked`, `recentlyDone`, `lastHandoff`); `journal` holds the last 10 session handoffs, newest first |
| `POST /api/journal` | Append a session handoff to `.agentboard/journal.md`: `{ summary?, done?, next?, blockers?, author? }` (the lists are string arrays; `author` defaults to `agent`). Returns `201` with the stored entry (`at`, `author`, `summary`, `done`, `next`, `blockers`); `400` when it has neither a summary nor any list item |

## Memory & stats

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/memory` | Persistent learnings memory |
| `PUT /api/memory` | Replace the memory file |
| `POST /api/memory/append` | Append a timestamped learning |
| `GET /api/stats` | Global board stats |
| `GET /api/git/commit-counts` | Commit counts per task |

## Events

### `GET /api/events`

Server-Sent Events stream. Emits a `change` event whenever any board file changes on disk — this is how the UI stays in sync when you edit `.agentboard/` files directly.

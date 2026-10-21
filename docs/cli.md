# CLI reference

The `agentboard` binary ships in [`@jmrojas06/agentsprint-cli`](https://www.npmjs.com/package/@jmrojas06/agentsprint-cli).

```text
agentboard [command] [dir]

Commands:
  init [dir]        Scaffold a board in the directory (default: current dir)
  serve [dir]       Start the server + UI (default command)
  spec <dir> <id>   Print the agent prompt (spec) for a task, e.g. TK-1
  brand [dir]       Print the company/brand kit for the project
  lint [dir]        Check board integrity (YAML, IDs, sprints, deps)
  doctor [dir] [--url <url> ...] [--json]
                    Check board, local build, server commits and the MCP entry
  close [dir] [id]  Close a sprint (auto-appends a retro to learnings.md)
  task new [title] [dir]
                    Create a task, optionally from a template
  task <claim|release|status|note|check|review|show> <dir> <id> ... [--agent <name>]
                    Work a task without MCP (same locks, activity and errors)
  import todo <dir> <file>
                    Import bullets/checkboxes from a TODO/NOTES markdown file
  import github <dir> <owner/repo>
                    Import open GitHub issues via the gh CLI
  export md [dir] [--sprint <id>]
                    Write BOARD.md — a static Markdown snapshot of the board
  review [dir] [--sprint <id>] [--json] [--done <ids>] [--changes <ids> --finding <x> ...]
                    Human review queue; --done / --changes apply your decision
  help              Show help

Options:
  --port <n>        Port to listen on (default: 4310)
  --host <ip>       Host to bind (default: 127.0.0.1)
  --no-open         Do not open the browser automatically
  --no-fallback     Disable auto port fallback if port is busy
  --init            Auto-create a board if missing (serve)
  --mcp             Also expose MCP tools at /mcp (Streamable HTTP)
  --token <secret>  Require Authorization: Bearer <secret> for mutating API/MCP calls (or env AGENTBOARD_TOKEN)
  --token-all       With --token, also protect GETs — all /api/* need auth
  --allowed-host <name>    Accept this hostname in Host/Origin besides localhost (repeatable, or env AGENTBOARD_ALLOWED_HOSTS)
  --allowed-origin <origin> Accept browser requests from this exact origin (repeatable, or env AGENTBOARD_ALLOWED_ORIGINS)
  --version         Print the version

Options (close):
  --no-retro        Skip the automatic retro appended to learnings.md

Options (task new):
  --template <name> Create the task from .agentboard/templates/<name>.md
  --var <k=v>       Fill a template variable (repeatable)
```

## Commands

### `init [dir]`

Scaffolds `.agentboard/` with sample tasks, templates, a first sprint and an `AGENTS.md`. Safe to run in any project — it never touches existing files outside `.agentboard/`.

### `serve [dir]`

Starts the Fastify server, serves the React SPA, watches board files for changes and exposes the REST + SSE API. With `--mcp`, MCP tools are also available at `/mcp` on the same port (see the [MCP guide](/mcp)).

When port `4310` is busy, AgentSprint automatically tries the next free port (`4311`, …). Disable with `--no-fallback` to fail fast with `EADDRINUSE`.

Git commit lookups (`/api/git/commit-counts`, `/api/tasks/:id/commits`) are cached for 10 s and cleared on every board change; set env `AGENTBOARD_GIT_CACHE_TTL_MS` to change the TTL in milliseconds (`0` disables the cache).

#### Authentication (optional `--token` / `AGENTBOARD_TOKEN`)

By default no auth is required. To protect the board:

```bash
agentboard serve --token my-secret
# or
AGENTBOARD_TOKEN=my-secret agentboard serve
```

* Without a token, every client (web, CLI, MCP) can read and write.
* With a token, `POST`/`PUT`/`PATCH`/`DELETE` to `/api/*` and `/mcp` need `Authorization: Bearer my-secret` or they receive `401 { "error": "Unauthorized" }`.
* Add `--token-all` alongside `--token` to also require the header for `GET`s: `agentboard serve --token my-secret --token-all`.
* The secret is never logged.
* **Web** — on `401` the UI shows a token prompt, saves it to `localStorage` key `agentsprint-token`, and retries. Use “Clear token” to remove it.
* **CLI / MCP HTTP** — on `401` set `AGENTBOARD_TOKEN` or pass `--token` and retry with `Authorization: Bearer <token>`. Example: `curl -H "Authorization: Bearer $AGENTBOARD_TOKEN" http://127.0.0.1:4310/api/tasks`.
* **MCP stdio** — stdio transport bypasses HTTP auth; only the HTTP endpoint (`/mcp`) is protected.

#### Cross-site protection (Host / Origin)

Independently of the token, the server refuses browser requests that come from other sites, so a web page you visit cannot read or edit the board through your browser:

* Requests with an `Origin` header are answered only when the origin is `localhost` / `127.0.0.1` / `[::1]` (any port, which covers the Vite dev server), the board itself, a host from `--allowed-host`, or an origin from `--allowed-origin`. Anything else gets `403`.
* When bound to loopback (the default) the `Host` header must also be a loopback name or an allowed host. This blocks DNS-rebinding attacks.
* CLI, MCP and `curl` clients send no `Origin` and are unaffected.
* With `--host 0.0.0.0` (Docker), the `Host` check is only enforced if you pass `--allowed-host <name>` for every name you browse to, e.g. `--allowed-host board.lan`. The server prints a warning otherwise.

### `spec <dir> <id>`

Prints a self-contained agent prompt for a task: description, acceptance criteria, brand guidelines and agent rules. This is exactly what the UI's *Copy spec* button puts on your clipboard.

### `brand [dir]`

Prints the configured brand kit (identity, colors, fonts, design assets, rules) from `.agentboard/brand.md`. Returns an empty kit if not configured.

### `lint [dir]`

Checks board integrity and exits non-zero on problems:

- Malformed YAML frontmatter or missing required fields
- Duplicate task IDs / invalid ID format
- Tasks referencing non-existent sprints or dependencies (cycles included)
- Warning `NO_ACCEPTANCE_CRITERIA` for tasks not in Done that have no acceptance criteria (dispatch holds them back)

Useful as a CI step:

```yaml
- run: npx @jmrojas06/agentsprint-cli lint .
```

### `doctor [dir] [--url <url> ...] [--json]`

Tells you which AgentSprint you are actually talking to and what is out of date. One line per check (`✔` ok, `⚠` warning, `✖` error) with the fix after `→`; exits non-zero only when a check is an error.

| Check | Looks at | Typical fix |
| --- | --- | --- |
| `board` | `lint` errors and warnings | `agentboard lint` |
| `board files` | `.lock` / `.tmp` files left by a crashed writer, and `.agentboard/` paths owned by another user (e.g. root, written by a container) | delete them / `sudo chown -R` |
| `build` | when the CLI runs from a source checkout: any `packages/*/src` newer than its `dist` (tests ignored) | `pnpm build` |
| `server <url>` | `GET <url>/api/health` for each `--url` (repeatable, default `http://127.0.0.1:4310`): its `commit` vs the checkout's `HEAD`. A `-dirty` commit means it was built from a modified tree; no commit means an image older than build stamping | `pnpm docker:up` |
| `mcp` | the `agentsprint` entry of the project's `.mcp.json` points at files that exist | `pnpm build` or `agentboard connect` |

```bash
agentboard doctor .
agentboard doctor . --url http://127.0.0.1:4310 --url http://127.0.0.1:5173 --json
```

`--json` prints `{ ok, checks: [{ name, level, message, fix? }] }`.

### `close [dir] [id]`

Closes a sprint (the active one if no id is given): sets its `endedAt` timestamp. By default an automatic retrospective is appended to `.agentboard/learnings.md`; pass `--no-retro` to skip it.

```bash
agentboard close . 2
```

### `task new [title] [dir]`

Creates a new task with the given title (defaults to "New task") in `To Do`. With `--template <name>` the task is created from `.agentboard/templates/<name>.md`, filling each `{{placeholder}}` with a matching `--var key=value` (repeatable).

```bash
agentboard task new "Add OAuth login" --template bug --var severity=high
```

### `task <claim|release|status|note|check|review|show> <dir> <id> …`

The task workflow for agents without the MCP server. Each subcommand calls the same `ProjectStore` method as its `task_*` MCP tool, so it takes the same lock, writes the same activity line, sanitizes the actor the same way and fails with the same message. `--agent <name>` is the actor recorded in the activity and notes (default `agent`, like MCP). Errors print `✖ <message>` and exit 1; success prints one `✔` summary line.

| Subcommand | MCP tool | What it does |
| --- | --- | --- |
| `claim <dir> <id> [--agent <name>] [--force]` | `task_claim` | Refuses while dependencies are open or another agent holds the 30‑min lock; otherwise locks, moves to In Progress and assigns the claiming agent. `--force` overrides both. |
| `release <dir> <id> [--agent <name>] [--force]` | `task_release` | Drops your lock; a foreign lock needs `--force`. |
| `status <dir> <id> <status> [--agent <name>]` | `task_status` | `Backlog`, `To Do`, `In Progress`, `Review` or `Done` (quote the ones with spaces). |
| `note <dir> <id> <text> [--agent <name>]` | `task_note` | Appends `- [<ISO>] (<agent>) <text>` under `## Notes`. |
| `check <dir> <id> <index\|text> [--uncheck] [--agent <name>]` | `task_checklist` | Ticks a criterion by 0‑based index or by a substring of its text; `--uncheck` clears it. |
| `review <dir> <id> --agent <name> --verdict approve\|changes [--finding <x> …] [--summary <x>]` | `task_review` | Review-gate verdict on a task in Review; `changes` needs at least one `--finding` and sends the task back to In Progress. |
| `show <dir> <id> [--json]` | `task_spec` / `task_get` | Prints the agent spec, or the whole task as JSON (notes and activity included). |

```bash
agentboard task claim . TK-12 --agent developer
agentboard task check . TK-12 "docs/cli.md" --agent developer
agentboard task note . TK-12 "Reused ProjectStore.lockTask" --agent developer
agentboard task status . TK-12 Review --agent developer
agentboard task review . TK-12 --agent code-reviewer --verdict changes --finding "index.ts:40 misses the lock check"
```

### `import todo <dir> <file>`

Imports bullets/checkboxes from a TODO/NOTES-style Markdown file as tasks — one bullet per task, checkbox state mapped to status.

```bash
agentboard import todo . TODO.md
```

### `import github <dir> <owner/repo>`

Imports open GitHub issues via the `gh` CLI (must be authenticated). Labels can be mapped to tags with `--label-tag label=tag` (repeatable) and milestones to sprints with `--milestone-sprint milestone=sprintId`.

```bash
agentboard import github . jmrojas06/my-repo --label-tag bug=high
```

### `agents [dir]` / `agents sync [dir]`

`agents` lists the specialized agents. `agents sync` adds any missing default
agent (never overwrites yours) and regenerates `.claude/agents/` so Claude
Code can launch them as subagents. See [Specialized agents](./agents.md).

### `dispatch [dir] [--sprint <id>]`

Prints the orchestration plan for the active sprint (or `--sprint`): waves of
tasks that can run in parallel, the subagent for each one and its review gate.
Paste it into Claude Code.

### `review [dir] [--sprint <id>] [--json]`

Prints the human review queue: each task in Review with its criteria done/total,
the latest verdict and a recommendation — `approve` (approved with no change to
the work since and every criterion ticked), `changes-pending` (the latest verdict
asked for changes) or `look` (never reviewed, changed after its approval, or
approved with criteria still open) — plus the reason. Ids must be task ids
(`TK-12`); `--finding` only goes with `--changes`.
`--json` prints the same list as `GET /api/review-queue` and `review_queue`.

With decisions it applies them as the human (`user`) and exits 1 if any failed:
`--done TK-1,TK-2` moves tasks to Done; `--changes TK-3 --finding "…"` (one
`--finding` or more) sends them back to In Progress with the findings. Tasks not
in Review are refused and left untouched.

```bash
agentboard review . --done TK-12,TK-14
agentboard review . --changes TK-13 --finding "the empty state has no copy"
```

### `context [dir] [--hook]`

Prints the session brief: active sprint and progress, last session handoff,
tasks in progress (with their last note), waiting for review, next unblocked
tasks by priority, blocked tasks, recently done work and recent learnings.
Start every agent session with it. `--hook` exits silently when the folder has
no board, for use in hooks.

### `handoff [dir] --summary <text> [--done <x>] [--next <x>] [--blocker <x>] [--author <name>]`

Appends a session handoff to `.agentboard/journal.md`. `--done`, `--next` and
`--blocker` are repeatable. The next `context` shows it first.

```bash
agentboard handoff --summary "API done, UI started" --next "TK-12 settings screen" --blocker "CI needs a secret"
```

### `skills [dir]`

Lists the Claude Code skills installed in `<dir>/.claude/skills/` and
`~/.claude/skills/`, which agents preload each one, and warns about skills an
agent references that are not installed.

### `connect [dir]`

Registers the AgentSprint MCP server in `<dir>/.mcp.json`, keeping other
servers, and a `SessionStart` hook in `<dir>/.claude/settings.local.json` that
runs `agentboard context --hook` (existing settings and hooks are kept; re-running
replaces only its own hook). Restart Claude Code there and approve `agentsprint`. The entry uses absolute
paths of your machine (Node binary, CLI, board), so keep `.mcp.json` out of git
or re-run `connect` on each machine.

### `mcp [dir]`

Runs the MCP server over stdio for the board in `dir` (what `connect` points
Claude Code at).

### `export md [dir] [--sprint <id>]`

Writes `BOARD.md` next to the board config: a static Markdown snapshot with sprints, stats, all tasks grouped by status (including acceptance criteria) and current learnings. Use `--sprint <id>` to limit the export to a single sprint.

```bash
agentboard export md . --sprint 2
```

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
  close [dir] [id]  Close a sprint (auto-appends a retro to learnings.md)
  task new [title] [dir]
                    Create a task, optionally from a template
  import todo <dir> <file>
                    Import bullets/checkboxes from a TODO/NOTES markdown file
  import github <dir> <owner/repo>
                    Import open GitHub issues via the gh CLI
  export md [dir] [--sprint <id>]
                    Write BOARD.md — a static Markdown snapshot of the board
  help              Show help

Options:
  --port <n>        Port to listen on (default: 4310)
  --host <ip>       Host to bind (default: 127.0.0.1)
  --no-open         Do not open the browser automatically
  --no-fallback     Disable auto port fallback if port is busy
  --init            Auto-create a board if missing (serve)
  --mcp             Also expose MCP tools at /mcp (Streamable HTTP)
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

### `spec <dir> <id>`

Prints a self-contained agent prompt for a task: description, acceptance criteria, brand guidelines and agent rules. This is exactly what the UI's *Copy spec* button puts on your clipboard.

### `brand [dir]`

Prints the configured brand kit (identity, colors, fonts, design assets, rules) from `.agentboard/brand.md`. Returns an empty kit if not configured.

### `lint [dir]`

Checks board integrity and exits non-zero on problems:

- Malformed YAML frontmatter or missing required fields
- Duplicate task IDs / invalid ID format
- Tasks referencing non-existent sprints or dependencies (cycles included)

Useful as a CI step:

```yaml
- run: npx @jmrojas06/agentsprint-cli lint .
```

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

### `export md [dir] [--sprint <id>]`

Writes `BOARD.md` next to the board config: a static Markdown snapshot with sprints, stats, all tasks grouped by status (including acceptance criteria) and current learnings. Use `--sprint <id>` to limit the export to a single sprint.

```bash
agentboard export md . --sprint 2
```

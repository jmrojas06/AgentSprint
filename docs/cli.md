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
  --version         Print the version
```

## Commands

### `init [dir]`

Scaffolds `.agentboard/` with sample tasks, templates, a first sprint and an `AGENTS.md`. Safe to run in any project — it never touches existing files outside `.agentboard/`.

### `serve [dir]`

Starts the Fastify server, serves the React SPA, watches board files for changes and exposes the REST + SSE API. With `--mcp`, MCP tools are also available at `/mcp` on the same port (see the [MCP guide](/mcp)).

When port `4310` is busy, AgentSprint automatically tries the next free port (`4311`, …). Disable with `--no-fallback` to fail fast with `EADDRINUSE`.

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

# AgentSprint MCP server

AgentSprint ships a [Model Context Protocol](https://modelcontextprotocol.io)
server so any MCP-compatible AI coding agent can read, claim and complete
tasks from your board — without touching the UI.

## Authentication (optional bearer token)

When the Fastify server is started with `agentboard serve --token <secret>` (or `AGENTBOARD_TOKEN` env), every MCP HTTP call to `POST /mcp` (and `GET /mcp`, `DELETE /mcp`) requires `Authorization: Bearer <secret>`. Without it the server replies `401 { "error": "Unauthorized" }`. The secret is never logged.

* Without a token, the board stays open (backwards compatible).
* With `--token` alone, only mutating API/MCP routes are protected — MCP `initialize` still needs the header because it is a `POST`.
* With `--token --token-all`, every read (`GET /mcp`) is also protected.

Stdio MCP (`node packages/mcp/dist/index.js --root <dir>`) bypasses HTTP auth; use the token only for the Streamable HTTP endpoint (`/mcp`). On `401`, configure your client with:

```json
{ "headers": { "Authorization": "Bearer <secret>" } }
```

or set `AGENTBOARD_TOKEN` before starting the client. Example curl:

```bash
curl -i -H "Authorization: Bearer $AGENTBOARD_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' \
  http://127.0.0.1:4310/mcp
```

## Tools

28 tools are exposed over both transports (stdio and Streamable HTTP):

| Tool | Description |
| --- | --- |
| `board_summary` | Overview: active sprint, counts per status, completion % |
| `task_list` | List tasks with filters (status, sprint, assignee, search) |
| `task_get` | Get a single task by id |
| `task_create` | Create a task, optionally from a reusable template |
| `template_list` | List the reusable task templates in `.agentboard/templates/` (defaults, acceptance criteria and `{{placeholder}}` variables) |
| `task_update` | Update task fields |
| `task_status` | Move a task to a status |
| `task_claim` | Claim a task: set `In Progress` + assignee `agent` (exclusive lock with TTL) |
| `task_release` | Release your exclusive lock on a task so other agents can claim it (`force` breaks foreign/stale locks) |
| `task_checklist` | Check/uncheck an acceptance criterion by index or text |
| `task_note` | Append a timestamped execution note/log under `## Notes` |
| `task_delete` | Permanently delete a task |
| `task_spec` | Get the copy-paste agent prompt for a task |
| `brand_get` | Get brand kit guidelines, design tokens and assets |
| `brand_update` | Update company/brand kit (tokens, fonts, colors, guidelines) |
| `learnings_get` | Get the full contents of `.agentboard/learnings.md` — retro notes, rules and principles from past sprints |
| `learnings_append` | Append a single learning/retro entry to `.agentboard/learnings.md` |
| `sprint_current` | Active sprint + its tasks + stats (read this first) |
| `sprint_list` | List all sprints |
| `sprint_create` | Create a new planned sprint |
| `sprint_activate` | Set a sprint active |
| `sprint_close` | Close the active sprint (or specified by id) |
| `sprint_report` | Generate Markdown summary report of a sprint |
| `sprint_retro` | Generate the retrospective for a sprint (report + blockers) with suggested learnings worth persisting |
| `export_board` | Export the full board as a static Markdown document (sprints, tasks grouped by status, learnings); optionally limit to one sprint |
| `project_list` | (Multi-project) List available projects |
| `project_current` | (Multi-project) Show active project |
| `project_use` | (Multi-project) Switch active project |

## Resources

| Resource URI | Description |
| --- | --- |
| `agentboard://tasks` | Live list of all tasks on the board |
| `agentboard://sprint/current` | Active sprint, associated tasks, and sprint statistics |
| `agentboard://brand` | Brand kit tokens, assets, and guidelines |

## Prompts

| Prompt | Description |
| --- | --- |
| `execute-task` | Pre-formatted handoff prompt to execute a task by ID (with brand injection) |
| `sprint-plan` | Agent-assisted sprint planning: receives goal/capacity, returns a reviewable plan from backlog + velocity + learnings |
| `sprint-retro` | Workflow prompt to analyze sprint velocity and capture learnings |

## Setup

Point the server at the project root with `--root` (or `AGENTSPRINT_ROOT`,
or the current working directory).

### opencode

Add to `opencode.json` (project or global):

```json
{
  "mcp": {
    "agentsprint": {
      "type": "local",
      "command": ["node", "/absolute/path/to/AgentSprint/packages/mcp/dist/index.js", "--root", "/absolute/path/to/your-project"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add agentsprint -- node /path/to/AgentSprint/packages/mcp/dist/index.js --root /path/to/your-project
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agentsprint": {
      "command": "node",
      "args": ["/path/to/AgentSprint/packages/mcp/dist/index.js", "--root", "/path/to/your-project"]
    }
  }
}
```

> Note: after a global install (`npm i -g @jmrojas06/agentsprint-mcp`) the
> command is simply `agentboard-mcp --root <dir>`; with npx use
> `npx @jmrojas06/agentsprint-mcp --root <dir>`.

## Suggested workflow for the agent

Your repo already ships an `AGENTS.md` that instructs agents to:

1. Read `.agentboard/sprints/` to learn the active sprint.
2. Work one task at a time; `task_claim` when starting.
3. Set `Review` when acceptance criteria are met — a human decides "Done".

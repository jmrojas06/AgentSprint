# AgentSprint MCP server

AgentSprint ships a [Model Context Protocol](https://modelcontextprotocol.io)
server so any MCP-compatible AI coding agent can read, claim and complete
tasks from your board — without touching the UI.

## Tools

| Tool | Description |
| --- | --- |
| `board_summary` | Overview: active sprint, counts per status, completion % |
| `task_list` | List tasks with filters (status, sprint, assignee, search) |
| `task_get` | Get a single task by id |
| `task_create` | Create a task |
| `task_update` | Update task fields |
| `task_status` | Move a task to a status |
| `task_claim` | Claim a task: set `In Progress` + assignee `agent` |
| `task_spec` | Get the copy-paste agent prompt for a task |
| `sprint_current` | Active sprint + its tasks + stats (read this first) |
| `sprint_list` | List all sprints |
| `sprint_activate` | Set a sprint active |

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

> Note: when the package is published to npm the command becomes
> `npx agentboard-mcp --root <dir>`.

## Suggested workflow for the agent

Your repo already ships an `AGENTS.md` that instructs agents to:

1. Read `.agentboard/sprints/` to learn the active sprint.
2. Work one task at a time; `task_claim` when starting.
3. Set `Review` when acceptance criteria are met — a human decides "Done".

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

## Errors

A failed call returns `isError: true` with a JSON body `{ "error": "<message>" }` (plus extra fields where useful, e.g. `blockers` from `task_claim`). Invalid arguments are rejected by the schema with a JSON-RPC `-32602` error.

Tools that modify a task (`task_create`, `task_update`, `task_status`, `task_claim`, `task_checklist`, `task_note`, `task_review`, `review_decide`) return a short acknowledgement instead of the whole task: `id`, `title`, `status`, `priority`, `assignee`, `sprint`, `dependencies`, `tags`, `ac` (criteria done/total, e.g. `"3/7"`), `lockedBy` and `lastActivity`; `task_checklist` adds `acceptanceCriteria`. `task_list` returns `{ total, tasks }` with one summary row per task (at most `limit`, default 50; `full: true` for whole tasks) and `task_get` the full task. JSON results are not indented. `learnings_append` returns `{ ok: true, entry }`.

## Multiple agents

Each agent can run its own stdio server on the same board. Every tool call re-syncs with the files on disk first, ids are allocated under a board-wide lock and `task_claim` checks the lock against the on-disk state, so agents in different processes see each other's work and never get the same task id or the same claim.

## Tools

40 tools are exposed; `project_list`, `project_current` and `project_use` exist only over the multi-project HTTP transport, so a stdio server exposes 37. `project_context` works on every transport. The server also sends **instructions** at initialize that tell the agent to continue from the session brief (calling `project_context` once only if the SessionStart hook did not already inject it) and to end with `session_handoff`.

| Tool | Description |
| --- | --- |
| `project_context` | **Start here.** Markdown brief: sprint progress, last handoff, in progress (with last note), waiting for review, next unblocked tasks, blocked, recently done, recent learnings |
| `session_handoff` | Append a handoff to `.agentboard/journal.md`: summary, done, next, blockers |
| `session_journal` | The most recent handoffs, newest first |
| `task_review` | Review-gate verdict on a task in Review: `approve`, or `changes` with findings (moves it back to In Progress) |
| `review_queue` | Human review queue (`sprint`, `ids` filters): per task in Review its criteria done/total, latest verdict (who, when, summary, findings), `approvedSinceLastChange` and a recommendation (`approve` \| `look` \| `changes-pending`) with the reason |
| `review_decide` | Record the human's decision on a task in Review: `{ id, decision: "done" \| "changes", findings?, by? }`. `done` moves it to Done, `changes` sends it back with the findings; `by` defaults to `user`. Refuses tasks not in Review |
| `skill_list` | Installed Claude Code skills and the ones agents reference but are missing |
| `board_summary` | Overview: active sprint, counts per status, completion % |
| `task_list` | List tasks with filters (status, sprint, assignee, search) as summary rows; `limit`, `full` |
| `task_get` | Get a single task by id |
| `task_create` | Create a task, optionally from a reusable template |
| `task_create_batch` | Create up to 50 tasks in one call; `ref` + `dependsOn` link them, validated before any write |
| `template_list` | List the reusable task templates in `.agentboard/templates/` (defaults, acceptance criteria and `{{placeholder}}` variables) |
| `task_update` | Update task fields |
| `task_status` | Move a task to a status |
| `task_claim` | Claim a task: set `In Progress` (exclusive lock with TTL). A subagent claiming with its own `agent` name becomes the assignee; specialized assignees are kept |
| `task_release` | Release your exclusive lock on a task so other agents can claim it (`force` breaks foreign/stale locks) |
| `task_checklist` | Check/uncheck an acceptance criterion by index or text |
| `task_note` | Append a timestamped execution note/log under `## Notes` |
| `task_delete` | Permanently delete a task |
| `task_spec` | Get the copy-paste agent prompt for a task |
| `brand_get` | Get brand kit guidelines, design tokens and assets |
| `brand_update` | Update company/brand kit (tokens, fonts, colors, guidelines) |
| `learnings_get` | Get the full contents of `.agentboard/learnings.md` — retro notes, rules and principles from past sprints |
| `learnings_append` | Append a single learning/retro entry to `.agentboard/learnings.md` |
| `agent_list` / `agent_get` | List the specialized agents / read one full prompt |
| `agent_upsert` / `agent_delete` | Create, update or delete an agent, including its `skills` and `disallowedTools` (also regenerates its Claude Code subagent) |
| `agent_sync` | Regenerate `.claude/agents/` (`installDefaults` adds missing default agents) |
| `sprint_dispatch` | Waves of parallel tasks with the subagent and review gate for each one, plus a Review gate section (Markdown or JSON) |
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
| `agentboard://agents` | Specialized agent profiles with their prompts |

## Prompts

| Prompt | Description |
| --- | --- |
| `resume` | Pick up where the last session left off: the project brief plus instructions to continue and hand off |
| `execute-task` | Pre-formatted handoff prompt to execute a task by ID (with brand injection) |
| `sprint-plan` | Agent-assisted sprint planning: receives goal/capacity, returns a reviewable plan from backlog + velocity + learnings |
| `sprint-retro` | Workflow prompt to analyze sprint velocity and capture learnings |
| `run-sprint` | Orchestrate the active sprint: one subagent per task, wave by wave |
| `idea-to-mvp` | Turn an idea into a scoped MVP sprint with assigned, linked tasks, then build it |
| `human-review` | Approve from the chat: `review_queue`, an optional `review-assistant` brief, batched questions to the human, then `review_decide` (and `sprint_close` only if the human chose it) |

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
agentboard connect /path/to/your-project
```

writes the server into the project's `.mcp.json`. Or register it by hand:

```bash
claude mcp add agentsprint -- node /path/to/AgentSprint/packages/mcp/dist/index.js --root /path/to/your-project
```

The specialized agents are also generated as Claude Code subagents — see
[Specialized agents & subagents](./agents.md).

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

1. If the session did not already begin with the brief (Claude Code's SessionStart hook injects it), call `project_context` (or run `agentboard context`) once to learn where the project is.
2. Work one task at a time; `task_claim` when starting.
3. Set `Review` when acceptance criteria are met; a reviewer subagent records a verdict with `task_review`, and a human decides "Done".
4. End the session with `session_handoff`.

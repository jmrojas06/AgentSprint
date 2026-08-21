# Quick start

From zero to an agent working your board in about two minutes.

## 1. Scaffold the board

Inside the project you want to manage:

```bash
npx @jmrojas06/agentsprint-cli init
```

This creates:

```text
.agentboard/
├── config.yaml           ← workflow columns & statuses
├── tasks/TK-1.md …       ← sample tasks
└── sprints/sprint-1.md   ← first sprint
AGENTS.md                 ← instructions for any AI agent
```

## 2. Open the board

```bash
npx @jmrojas06/agentsprint-cli serve
```

The UI opens at `http://127.0.0.1:4310`. Plan a sprint, write tasks with clear acceptance criteria, and set estimates.

## 3. Let the agent work

Point your AI coding agent at the repo. It follows `AGENTS.md`:

1. Reads the active sprint and picks one task.
2. Sets `status: In Progress` and `assignee: agent` in the task file.
3. Implements it, checking off acceptance criteria.
4. Moves the task to **Review** when every criterion is satisfied.

With [opencode](https://opencode.ai), start the server with MCP enabled and add:

```json
{
  "mcp": {
    "agentsprint": {
      "type": "remote",
      "url": "http://127.0.0.1:4310/mcp"
    }
  }
}
```

The agent can then claim tasks, tick checklists and log progress through tools instead of editing files manually — see the [MCP guide](/mcp).

## 4. You review

Finished tasks wait in **Review**. Open each one, verify the acceptance criteria, and drag it to **Done** (or edit `status: Done` directly in the file). Everything is committed to git by you, on your cadence.

## 5. Close the sprint, plan the next

When the sprint is done, close it from the Sprints panel and plan the next one from your backlog. The board's history stays in git forever.

## Everyday commands

```bash
agentboard serve            # open the board
agentboard spec . TK-3      # print an executable prompt for a task
agentboard lint .           # validate board integrity (great for CI)
```

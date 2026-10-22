# Quick start

From zero to Claude Code working your board in a few minutes.

You need [Node.js](https://nodejs.org) 20 or newer, a Git repository for your
project and [Claude Code](https://code.claude.com). No account, no cloud.

## 1. Create the board and connect Claude Code

Inside the project folder:

```bash
npx @jmrojas06/agentsprint-cli init
npx @jmrojas06/agentsprint-cli connect
```

`init` creates:

```text
.agentboard/
├── config.yaml           ← workflow columns & statuses
├── tasks/TK-1.md …       ← three getting-started examples
├── sprints/sprint-1.md   ← a first sprint (not active yet)
└── agents/               ← specialist profiles you can edit
.claude/agents/           ← the same profiles as Claude Code subagents
AGENTS.md                 ← instructions for any AI agent
```

`connect` registers the `agentsprint` MCP server in `.mcp.json` and a
`SessionStart` hook in `.claude/settings.local.json`, so every Claude Code
session starts with a short brief of where the project is.

Prefer a short command? `npm install -g @jmrojas06/agentsprint-cli` gives you
`agentboard init`, `agentboard connect` and the rest.

## 2. Start Claude Code and tell it what you are building

Open Claude Code in the folder and approve the `agentsprint` server when it
asks. The first brief notices that the board only holds the examples, so
Claude asks what you are building instead of working on them. Describe it in
your own words; Claude turns it into tasks with acceptance criteria and offers
to delete the examples.

For a bigger idea, open the board (step 4) and choose **Start from an idea**:
it builds a planning prompt to paste into Claude Code.

## 3. Work, one task at a time

Ask Claude to continue (`/mcp__agentsprint__resume`) or name a task. It claims
the task, implements it, ticks each acceptance criterion and moves it to
**Review**. Before the session ends it leaves a handoff, so the next session
picks up exactly there.

Two ways to run the work, pick per task:

- **Light (default):** your main session does the task itself. Cheapest, and
  enough for most work.
- **Full:** `/mcp__agentsprint__run-sprint` hands each task to a specialist
  subagent and then to a read-only reviewer before it reaches you. Every
  subagent starts fresh and reads the code again, so this costs noticeably
  more tokens; use it for larger sprints or work you want double-checked.

The specialists use the skills you have installed when they need them; none is
preloaded. See [Agents, skills and review gate](/agents#skills) for where the
suggested skills come from and how to add your own agents.

## 4. Look at the board and review

```bash
npx @jmrojas06/agentsprint-cli serve
```

The board opens at `http://127.0.0.1:4310`. Finished tasks wait in **Review**:
check the acceptance criteria and move them to **Done** there, or approve from
the chat with `/mcp__agentsprint__human-review`. Commit the board with your
code; Git history is the board's history.

## Other agents

Agents that are not Claude Code read the same instructions from `AGENTS.md`.
To give one the MCP tools, run `serve --mcp` and point it at
`http://127.0.0.1:4310/mcp`. With [opencode](https://opencode.ai):

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

## Everyday commands

```bash
agentboard context .        # the brief a new session starts from
agentboard serve            # open the board
agentboard spec . TK-3      # print an executable prompt for a task
agentboard doctor .         # check the board, the MCP entry and the build
```

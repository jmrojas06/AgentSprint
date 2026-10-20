# Specialized agents & subagents

AgentSprint ships a team of specialized agents and turns each one into a real
**Claude Code subagent**. You assign a task to a specialist, and the
orchestrator (your main Claude Code session) launches that subagent to build
it — several at once when the tasks are independent.

## The default team

`agentboard init` (or `agentboard agents sync` on an existing board) writes
seven profiles to `.agentboard/agents/`:

| Agent | Role |
| --- | --- |
| `developer` | Smallest correct change; reuses what exists; full suite green before Review |
| `designer` | UI/UX from the brand kit: hierarchy, consistency, accessibility, every state |
| `tester` | Tests derived from acceptance criteria; edge cases first; proves tests can fail |
| `fixer` | Reproduce, find root cause, failing test first, smallest patch |
| `docs` | README, guides, CHANGELOG — verified against the code that ships |
| `creative-director` | Owns vision and tone; approves, revises or rejects with a direction |
| `ideator` | Divergent options fast, then a ranked shortlist and a recommendation |

A profile is one Markdown file — the filename is the agent name, the body is
its prompt:

```markdown
---
description: "Payments specialist: Stripe Checkout, webhooks and billing portal."
color: "#3b82f6"
tags: [payments]
tools: []        # optional Claude Code tool allowlist; empty = inherit all (MCP included)
model: inherit   # inherit | sonnet | opus | haiku
---

You are the **Stripe Expert**.

## Mission
...
```

Create or edit agents from the **Agents** tab of the board, with the
`agent_upsert` MCP tool, or by editing the file.

## Real subagents in `.claude/agents/`

Every profile is mirrored to `.claude/agents/<name>.md` in Claude Code's
subagent format, with the AgentSprint protocol appended (claim the task, read
its spec, tick criteria, log notes, move to Review). The sync runs:

- on `agentboard init`, `agentboard agents sync` and the `agent_sync` MCP tool;
- whenever an agent is saved or deleted (UI, API or MCP);
- while `agentboard serve` runs, every time a file in `.agentboard/agents/` changes.

It is idempotent and safe: only files carrying the `agentsprint:generated`
marker are rewritten or removed; a hand-written subagent with the same name is
never touched (it is reported as skipped). Opt out with `subagents: false` in
`.agentboard/config.yaml`.

Claude Code loads new subagents at startup — restart it (or open `/agents`)
after adding one.

## Task specs know their agent

When a task's `assignee` is an agent name, `task_spec` (and
`agentboard spec`) injects an **Agent profile** section with that agent's
prompt. Specialized assignees keep their name across status changes, and
`task_claim { id, agent: "designer" }` assigns the task to the claiming
subagent.

## Running a sprint with subagents

`sprint_dispatch` (MCP), `agentboard dispatch` (CLI), `GET /api/dispatch` and
the **Run sprint** button all compute the same plan:

- pending tasks of the sprint split into **waves**: a task lands one wave
  after its latest dependency, so the tasks inside a wave can run in parallel;
- each task gets its **subagent**: its specialized assignee, `developer` for
  workflow roles, `general-purpose` when no profile matches;
- tasks that can never start (missing dependency, dependency outside the
  sprint, cycle) are listed as **blocked** with the reason.

In Claude Code run the `run-sprint` prompt (`/mcp__agentsprint__run-sprint`)
or paste the prompt copied from the board. The orchestrator launches every
task of a wave in parallel with the Agent tool, verifies between waves, and
re-dispatches until nothing is left — then you review what is in Review.

## Idea → MVP

The `idea-to-mvp` prompt (`/mcp__agentsprint__idea-to-mvp`) takes an idea and
walks the orchestrator through: ideator + creative-director to cut the MVP,
brand kit, any missing specialist (`agent_upsert`), a sprint, one
`task_create_batch` call with every task assigned and linked by dependencies,
and finally `sprint_dispatch` to build it wave by wave.

`task_create_batch` creates up to 50 tasks at once; each item may carry a
`ref` label and `dependsOn` (refs in the batch or existing ids). The whole
batch is validated before anything is written.

## Connect Claude Code

```bash
agentboard connect .
```

Registers the AgentSprint MCP server in `./.mcp.json` (keeping any other
servers). Restart Claude Code in the folder and approve the `agentsprint`
server.

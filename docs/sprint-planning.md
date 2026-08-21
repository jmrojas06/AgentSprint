# Sprint planning assisted by the agent

AgentSprint closes the loop of the flow **IA plans → IA implements → human reviews → learnings feed the next cycle**. The MCP prompt `sprint-plan` turns your backlog + history into a concrete, reviewable sprint proposal.

## The flow

1. **Prepare a backlog** — dump ideas into `Backlog` (UI, `task_create`, or `agentboard import`).
2. **Run the prompt** — from any MCP client ask for the `sprint-plan` prompt:
   - optional args: `goal` (proposed goal), `capacity` (story points), `sprint` (id of a planned sprint to fill).
3. **The agent proposes** — it receives:
   - the full backlog with priorities, estimates, tags and dependencies,
   - historical velocity (average points completed over the last 3 closed sprints),
   - the accumulated learnings from `.agentboard/learnings.md`.
4. **You review** — the plan arrives as Markdown (`Sprint plan proposal`) with goal, capacity check, an ordered table and risks. Nothing is modified until you approve.
5. **The agent executes** — after approval it applies the plan with `sprint_create` / `sprint_activate` / `task_update`.

## Example

```text
> Use the sprint-plan prompt with goal "Ship multi-project support" and capacity 8
```

The agent replies with:

```markdown
## Sprint plan proposal
**Goal:** Ship multi-project support
**Capacity:** 8 pts · **Planned total:** 8 pts · **Velocity reference:** 7 pts

| Order | Task | Priority | Estimate | Dependencies | Rationale |
|---|---|---|---|---|---|
| 1 | TK-27 | high | 2 | — | Unblocks parallel agent work |
| 2 | TK-28 | medium | 3 | TK-27 | Builds on locks |
...
**Risks:** TK-28 estimate may be optimistic given no prior UI work.
```

## Why estimates get smarter over time

Velocity is computed from real completed points, not aspirations. Combined with the learnings file (retros are appended automatically on every `sprint_close`), each planning cycle starts from what actually happened in previous sprints.

## Requirements

- Tools used by the flow: `task_list`, `task_update`, `task_create`, `sprint_create`, `sprint_activate`, `board_summary`. All ship by default.
- Multi-agent safety: tasks claimed via `task_claim` take exclusive locks, so several agents can execute different planned tasks at once.

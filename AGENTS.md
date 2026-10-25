# AgentSprint instructions

This project uses a git-native sprint board under `.agentboard/`.

## Start and end every session here

- **Start:** if the session did not already begin with the "Where we are" brief (Claude Code's SessionStart hook injects it), run `agentboard context` or call the `project_context` MCP tool once. It prints where the project is: active sprint, work in progress, what is next, blockers, the last session handoff and recent learnings. Continue from there — never restart from scratch.
- **End:** leave a handoff with the `session_handoff` MCP tool (summary, done, next, blockers), or append it to `.agentboard/journal.md`. The next session — yours or another agent's — starts from it.

## Workflow

1. **Read `.agentboard/sprints/`** to learn the active sprint before doing any work.
2. Tasks are single Markdown files in `.agentboard/tasks/`. Their status lives in the YAML frontmatter.
3. Work on ONE task at a time. When you start one, set its `status: In Progress` and `assignee: agent`.
4. When the task satisfies every acceptance criterion, set `status: Review` — a human reviews and moves it to `Done`.
5. Never skip or rewrite tasks. Update the file, don't create duplicates.
6. Prefer editing files directly over `agentboard` CLI/MCP when possible; the board UI reflects file changes instantly.
7. If `.agentboard/brand.md` exists and is configured, follow the brand guidelines when writing code, copy or UI.
8. `.agentboard/agents/` holds specialized agent profiles (developer, designer, tester, …), mirrored to `.claude/agents/` as real Claude Code subagents. Their prompts name the skills that help; installed ones are used on demand, nothing is preloaded unless a profile lists it under `skills:`. Edit or add profiles freely. A task assigned to one of them is done by that subagent — its prompt is also injected into the task spec. To run a sprint, ask `sprint_dispatch` (or `agentboard dispatch`) which subagent takes which task and what can run in parallel.
9. Work in Review passes a review gate first: `code-reviewer` (or `ui-reviewer` for UI work) records a verdict with `task_review`. `changes` sends the task back to In Progress with findings; `approve` leaves it for the human.

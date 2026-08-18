# AgentSprint instructions

This project uses a git-native sprint board under `.agentboard/`.

## Workflow

1. **Read `.agentboard/sprints/`** to learn the active sprint before doing any work.
2. Tasks are single Markdown files in `.agentboard/tasks/`. Their status lives in the YAML frontmatter.
3. Work on ONE task at a time. When you start one, set its `status: In Progress` and `assignee: agent`.
4. When the task satisfies every acceptance criterion, set `status: Review` — a human reviews and moves it to `Done`.
5. Never skip or rewrite tasks. Update the file, don't create duplicates.
6. Prefer editing files directly over `agentboard` CLI/MCP when possible; the board UI reflects file changes instantly.
7. If `.agentboard/brand.md` exists and is configured, follow the brand guidelines when writing code, copy or UI.

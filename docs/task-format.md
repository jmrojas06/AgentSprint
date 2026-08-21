# Task file format

Every task is a single Markdown file in `.agentboard/tasks/` — for example
`TK-1.md`. The YAML frontmatter is machine-readable state; the Markdown body
is what humans and agents read.

```markdown
---
id: TK-1
title: Write your first task spec
status: To Do          # Backlog | To Do | In Progress | Review | Done
sprint: 1              # sprint id, or null
priority: medium       # low | medium | high | critical
assignee: human        # human | agent
estimate: 2            # story points (0–100)
tags:
  - getting-started
dependencies: []       # task ids this task is blocked by
createdAt: '2026-08-01T10:00:00.000Z'
updatedAt: '2026-08-01T10:00:00.000Z'
---
## Description

What needs to be done and why.

## Acceptance criteria

- [ ] First criterion
- [ ] Second criterion

## Notes

Timestamped execution notes appended by agents.
```

## Rules that make it agent-friendly

- **The frontmatter is the source of truth.** The board UI reads and writes
  it; editing the file directly updates the board within milliseconds.
- **`status` moves left to right**: an agent sets `In Progress` when it claims
  a task and `Review` when every acceptance criterion is checked. Only you set
  `Done`.
- **Acceptance criteria are checkboxes.** Agents tick them via the checklist
  API/MCP tool or by editing `- [ ]` → `- [x]`.
- **IDs are immutable.** Never rename a task file or change its `id` — git
  commits and dependencies reference it.

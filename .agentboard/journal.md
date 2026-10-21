# Session journal

<!-- Append-only log of session handoffs, oldest first. Written by session_handoff
     (MCP), the board UI or by hand: "## <ISO date> — <author>" then the sections. -->

## 2026-10-20T22:35:49.621Z — claude

**Summary:** Turned the board into a project control center: agents preload skills, a code/UI review gate checks work in Review, and every session starts from agentboard context and ends with a handoff.

**Done:**
- TK-38 skills in agent profiles and subagents
- TK-39 code-reviewer and ui-reviewer with task_review
- TK-40 project_context, session_handoff, journal and SessionStart hook
- TK-41 Overview view and UI polish

**Next:**
- Human review of Sprint 6 and Sprint 7 tasks in Review, then close Sprint 6 and activate Sprint 7
- Run the review gate on Sprint 7 with the code-reviewer and ui-reviewer subagents

**Blockers:**
- TK-36 belongs to another project (notes app) and sits in Sprint 6 To Do; decide whether to move or delete it

## 2026-10-21T20:36:35.905Z — claude

**Summary:** Used AgentSprint on itself: dispatched 4 waves of specialist subagents through the review gate, fixed 9 review findings and 4 dogfooding bugs, and replaced the 2-month-old Docker board at :4310 (it hid 13 tasks and could erase review history) with a current, non-root build that shows its commit.

**Done:**
- TK-43 brief/spec no longer leak retro dumps (learningsTail moved to spec.ts)
- TK-44 dispatch blocks and lint warns on tasks without acceptance criteria
- TK-45 compact MCP write responses
- TK-46 one-line author names, shell-safe SessionStart hook, case-insensitive tags
- TK-47 Docker: pnpm docker:up, non-root image with git, loopback port, /api/health {version,commit,builtAt}, parse warnings say why
- Review gate round 2/3: TK-31, 32, 34, 35, 37, 41, 42 approved after fixes; TK-29, 30, 38, 39, 40, 43, 44, 45, 46 approved; TK-33 back in Review after the Escape/data-loss fix (needs one more ui-reviewer pass)
- Removed stray Notely task TK-36 (duplicate of notely TK-65); stale board service removed from ../docker-compose.yml

**Next:**
- Human: review Sprint 6 and Sprint 7 tasks in Review and move them to Done; close TK-32 as a duplicate of TK-35; close Sprint 6 and activate Sprint 7
- Run ui-reviewer once more on TK-33 (useEscapeLayer fix, chip contrast, aria-labels)
- Commit the session's work on feature/specialized-agents (nothing committed yet) and open the PR
- Reconnect the agentsprint MCP server in Claude Code (/mcp) after pnpm build so it serves the current dist
- Follow-ups noted by reviewers: unlocked sprint creation (TK-35 note), actor names with | in activity lines (TK-46 note), silent rejection when a TaskModal save is cancelled (TK-33 note), Idea to MVP has no UI entry (TK-37 note)

**Blockers:**
- The stdio agentsprint MCP server disconnected at 19:32Z (exit 0, cause unknown); only the user can reconnect it

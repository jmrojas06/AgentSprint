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

## 2026-10-21T22:00:52.761Z — claude

**Summary:** Sprint 8 ran end to end on AgentSprint itself: 7 tasks (TK-48..54) built by specialist subagents, every one through the code/UI review gate, findings fixed and re-reviewed, committed (fb2519e, 8af2484) and pushed to PR #9; the Docker board at :4310 rebuilt from the clean commit.

**Done:**
- TK-48 agentboard doctor (lint, orphaned locks, foreign-owned files, stale dist, server commit vs HEAD, .mcp.json)
- TK-49 approve from the UI: Mark done, Request changes, Close approved (N)
- TK-50 refused saves keep edits with an inline message; focus returns to the opener card/row
- TK-51 sprint writes under a board-wide lock; one actor sanitizer (no |, (, ), newlines)
- TK-52 MCP stdio logs why it exits; the 2026-10-21 drop was a SIGINT from Claude Code, not a crash
- TK-53 Start from an idea: full prompt from a shared core builder (Claude Code splits slash-command args on spaces)
- TK-54 task/new-task modals are real dialogs; palette is a modal combobox; opening another task in place no longer saves the first task's fields over it

**Next:**
- Human: review Sprints 6, 7 and 8 in Review and move them to Done (Close approved (N) on the Overview does it in one go); close TK-32 with TK-35; close Sprint 6 and activate the next
- Merge PR #9 once CI is green (Auto-fix is on)
- Reconnect the agentsprint MCP server in Claude Code after pnpm build (it only loads dist at start); agentboard doctor shows what is stale
- Follow-ups: Delete in TaskModal has no confirmation; PID-namespace edge case in file locks (TK-35 note)

## 2026-10-21T22:54:56.204Z — claude

**Summary:** Sprint 9 delivered and closed: the human now approves from the chat (review_queue/review_decide + read-only review-assistant + human-review prompt), agents without MCP have a safe task CLI, dispatch flags parallel overlaps, and an older server can no longer degrade generated subagents (schema 2, proven live against the previous Docker image). 43 tasks approved by the user in chat this session; sprints 6, 7, 8 and 9 closed.

**Done:**
- TK-55 review queue (core/MCP/API/CLI), approve only when the approval is current and every criterion is ticked
- TK-56 agentboard task claim|release|status|note|check|review|show; subagents fall back to it
- TK-57 review-assistant (read-only by tools) + human-review prompt; used live to brief this session's last batch
- TK-58 dispatch parallel safety (files:, conflicts, worktree hint) and gate skip for current approvals
- TK-59 subagent schema guard + fingerprint test; SUBAGENT_SCHEMA=2
- TK-15 commit hashes from git log -z (gate finding); TK-16..22, 25, 47 approved; old Review backlog cleared

**Next:**
- Merge PR #9 (CI green, Auto-fix on)
- Reconnect the agentsprint MCP server in Claude Code (/mcp) so it serves the current dist; then /mcp__agentsprint__human-review works natively
- Follow-ups: keep unknown frontmatter keys on write (so older servers stop dropping files:); show dispatch conflicts in the web Run sprint modal; wave 0 vs In Progress overlap; single ProjectStore.claimTask shared by MCP and CLI; flaky TaskModal focus test under memory pressure; Delete confirmation in TaskModal

## 2026-10-22T14:01:06.469Z — human

**Summary:** Revisión de preparación para principiantes (sin cambios de código). Código actual sano: build OK, 648 tests pasan, init/connect/context/dispatch/MCP (39 tools, 7 prompts) y la UI funcionan desde el repo.

**Next:**
- Publicar 0.2.0 en npm (bump de versiones + tag v0.2.0; npm sigue en 0.1.0 del 23-ago y el quick start del README falla en 'connect')
- connect: no escribir rutas absolutas de la caché de npx en .mcp.json y el hook
- Board de ejemplo: TK-2 en In Progress con dependencia sin hacer y asignado a scrum-master inexistente; el primer brief manda a Claude a trabajar en el tutorial
- Skills de los especialistas no vienen instaladas en una máquina limpia: documentar cómo instalarlas o usar defaults públicos
- docs/quick-start.md desactualizado (sin connect, ejemplo de opencode, sección de video en español)

## 2026-10-22T14:13:18.218Z — human

**Summary:** Arreglado lo que frenaba a un principiante (TK-60, en Review, sin commit, rama fix/beginner-onboarding): versión 0.2.0 lista, connect portable con npx, agentes sin precarga de skills (ahorra ~9k-28k tokens por subagente), tablero de ejemplo coherente con aviso 'New board', quick-start y docs de skills. 651 tests verdes; e2e con tarballs OK.

**Next:**
- Revisar TK-60 (code-reviewer) y hacer commit/PR
- Publicar: merge a main, luego git tag v0.2.0 && git push origin v0.2.0 (release.yml publica en npm con NPM_TOKEN)
- Rehacer capturas del README (agents-dark.png muestra skills precargadas)
- Este repo mantiene sus perfiles con skills: precargadas; quitar las líneas skills: para ahorrar tokens

## 2026-10-22T14:29:15.023Z — human

**Summary:** PR #10 mergeado y 0.2.0 publicada en npm (los 5 paquetes) con GitHub Release v0.2.0. Los checks quedaron 'queued' por un incidente de GitHub Actions (degraded performance), no por el repo; el release corrió igual. Quick-start del README verificado desde npm en carpeta nueva: init, connect (escribe npx @0.2.0), hook con 'New board', MCP responde, 0 skills precargadas.

**Next:**
- Mover TK-60 a Done si está conforme (sigue en Review)
- Rehacer docs/public/screenshots/agents-dark.png (muestra skills precargadas)
- Quitar las líneas skills: de los perfiles de este repo para ahorrar tokens
- Confirmar que CI/Release/Docs de main terminan en verde cuando GitHub cierre el incidente

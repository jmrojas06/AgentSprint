## Sprint 3 retro — 2026-08-21

# Sprint 3 — Grafo de dependencias, bloqueos y memoria de aprendizaje

- **Status**: closed
- **Started**: 2026-08-20T17:00:00.000Z
- **Ended**: 2026-08-21T20:25:40.016Z
- **Progress**: 2/2 tasks done (100%)

## Tasks

### Backlog (0)

_none_


### To Do (0)

_none_


### In Progress (0)

_none_


### Review (0)

_none_


### Done (2)

- [high] **AS-8** — Grafo de dependencias y validación de bloqueos (agent)
- [medium] **AS-9** — Memoria persistente de aprendizajes y retrospectivas de sprint (agent)

## Retro

_Pendiente: qué fue bien, qué no, qué mejorar._

## Sprint 4 retro — 2026-08-21

# Sprint 4 — UX del board — filtros, checklists interactivos y badges

- **Status**: closed
- **Started**: 2026-08-21T20:25:41.667Z
- **Ended**: 2026-08-21T20:25:42.238Z
- **Progress**: 3/3 tasks done (100%)

## Tasks

### Backlog (0)

_none_


### To Do (0)

_none_


### In Progress (0)

_none_


### Review (0)

_none_


### Done (3)

- [high] **AS-10** — Checklists interactivos de criterios de aceptación en la UI (agent)
- [medium] **AS-11** — Barra avanzada de filtros y ordenamiento en el Kanban (agent)
- [medium] **AS-12** — Badges visuales de dependencias y bloqueos en la UI (agent)

## Retro

_Pendiente: qué fue bien, qué no, qué mejorar._

## Sprint 5 retro — 2026-08-21

# Sprint 5 — CLI linter de integridad y resiliencia de servidor

- **Status**: closed
- **Started**: 2026-08-21T20:25:43.475Z
- **Ended**: 2026-08-21T20:25:44.095Z
- **Progress**: 2/2 tasks done (100%)

## Tasks

### Backlog (0)

_none_


### To Do (0)

_none_


### In Progress (0)

_none_


### Review (0)

_none_


### Done (2)

- [high] **AS-13** — Comando CLI agentboard lint para validación de integridad (agent)
- [medium] **AS-14** — Resiliencia de puerto y fallback automático en agentboard serve (agent)

## Retro

_Pendiente: qué fue bien, qué mejorar._


## Reglas de proceso

- Un proyecto = un tablero: el board de AgentSprint (`.agentboard/`) solo contiene trabajo de AgentSprint (AS-* y TK-15..28). Las tareas/sprints de Notely (TK-29+) vivían aquí por error: el MCP `agentsprint` es global (correcto), pero el server tenía AgentSprint como proyecto ACTIVO y los agentes creaban tareas sin llamar antes a `project_use`. Migrado a `notely/.agentboard/` el 2026-08-24. Regla: al empezar cualquier sesión con tareas, SIEMPRE ejecutar `project_current`; si no coincide con el repo donde vive el código, `project_use <nombre>` antes de crear o editar nada.
- Antes de despachar un sprint, mira que cada tarea pendiente tenga criterios de aceptación y sea de este repo: TK-36 (de Notely, vacía) llegó a la Wave 1 para `developer`. Las tareas que se entregaron fuera del board (p. ej. en un PR) pasan a Review con los criterios sin marcar; el review gate es quien los comprueba.

## Sprint 6 retro — 2026-10-21

### Sprint 6 — Mejora interna de calidad e infraestructura: linting unificado del monorepo, CI con GitHub Actions, caché de endpoints costosos, escritura atómica segura en core y autenticación opcional por token en el server.

- **Status**: closed
- **Started**: 2026-08-26T12:55:22.878Z
- **Ended**: 2026-10-21T22:18:57.623Z
- **Progress**: 8/8 tasks done (100%)

#### Tasks

##### Backlog (0)

_none_


##### To Do (0)

_none_


##### In Progress (0)

_none_


##### Review (0)

_none_


##### Done (8)

- [high] **TK-29** — Linter del monorepo — ESLint flat config o Biome para todos los paquetes (perfect)
- [high] **TK-30** — CI con GitHub Actions — lint, typecheck, tests y build en cada PR (perfect)
- [medium] **TK-31** — Caché con TTL para /api/git/commit-counts (y /api/tasks/:id/commits si aplica) (developer)
- [medium] **TK-32** — Escritura atómica segura en core — tmp único por proceso y lock opcional (perfect)
- [high] **TK-33** — Autenticación por token opcional en el server (--token / AGENTBOARD_TOKEN) (developer)
- [high] **TK-34** — Auto-asignado según estado de la tarea (perfect)
- [high] **TK-35** — Escritura atómica segura en core (perfect)
- [high] **TK-37** — Agentes especializados como subagentes reales de Claude Code (+ Run sprint e Idea→MVP) (developer)

#### Retro

_Pendiente: qué fue bien, qué no, qué mejorar._

## Sprint 8 retro — 2026-10-21

### Sprint 8 — Un board en el que se puede confiar y actuar: doctor de entorno, aprobación humana desde la UI, escrituras seguras en todo el core, MCP que explica por qué se cae, e Idea → MVP desde la UI.

- **Status**: closed
- **Started**: —
- **Ended**: 2026-10-21T22:18:57.669Z
- **Progress**: 7/7 tasks done (100%)

#### Tasks

##### Backlog (0)

_none_


##### To Do (0)

_none_


##### In Progress (0)

_none_


##### Review (0)

_none_


##### Done (7)

- [high] **TK-48** — agentboard doctor — detecta builds viejos, Docker desactualizado y MCP mal configurado (developer)
- [critical] **TK-49** — Aprobación humana desde la UI: Mark done, Request changes y cerrar aprobadas en lote (designer)
- [medium] **TK-50** — Guardar con el prompt de token cancelado avisa en vez de fallar en silencio (designer)
- [high] **TK-51** — Escrituras seguras en todo el core: sprints con lock y actores saneados (fixer)
- [high] **TK-52** — El servidor MCP stdio explica por qué termina (fixer)
- [medium] **TK-53** — Idea → MVP desde la UI (developer)
- [high] **TK-54** — TaskModal y NewTaskModal son diálogos de verdad: foco dentro, Tab atrapado, role=dialog (designer)

#### Retro

_Pendiente: qué fue bien, qué no, qué mejorar._

## Sprint 7 retro — 2026-10-21

### Sprint 7 — Project control center: agents preload skills, a review gate checks their work, and every session resumes from the board (context brief + handoff journal). Polished UI and README.

- **Status**: closed
- **Started**: —
- **Ended**: 2026-10-21T22:24:55.043Z
- **Progress**: 10/10 tasks done (100%)

#### Tasks

##### Backlog (0)

_none_


##### To Do (0)

_none_


##### In Progress (0)

_none_


##### Review (0)

_none_


##### Done (10)

- [high] **TK-38** — Specialized agents preload Claude Code skills (developer)
- [high] **TK-39** — Review gate: code-reviewer and ui-reviewer subagents (developer)
- [critical] **TK-40** — Session continuity: project brief and handoff journal (developer)
- [high] **TK-41** — Overview view and UI polish (designer)
- [medium] **TK-42** — README and docs for skills, review gate and session continuity (docs)
- [high] **TK-43** — El brief de contexto filtra los retros automáticos de learnings.md (fixer)
- [high] **TK-44** — Dispatch y lint no deben despachar tareas sin criterios de aceptación (developer)
- [medium] **TK-45** — Respuestas compactas en las herramientas MCP que modifican el board (developer)
- [high] **TK-46** — Endurecer nombres de autor y el hook de SessionStart (hallazgos del review gate) (fixer)
- [critical] **TK-47** — Docker board al día, sin root y con la versión a la vista (developer)

#### Retro

_Pendiente: qué fue bien, qué no, qué mejorar._
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

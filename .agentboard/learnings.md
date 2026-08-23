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

_Pendiente: qué fue bien, qué no, qué mejorar._
- Sprint 6 (Notely central de operaciones) — 8 tareas entregadas a Review: command palette Ctrl+K, dashboard/Home, autosave debounce 800ms con flush on unmount, drag&drop todos, carry-over semanal, tags, pinned notes y papelera soft-delete. Aprendizajes: (1) onSave debe recibir id explícito + key={note.id} en el editor para nunca escribir en la nota equivocada al hacer flush tras cambiar de nota; (2) toggles tipo pinned NO deben tocar updated_at o reshufflea la lista; (3) migraciones de schema siempre idempotentes (CREATE IF NOT EXISTS + PRAGMA table_info antes de ALTER); (4) purga perezosa al arrancar del server es suficiente para la papelera (30 días). 17/17 tests server. Errores TS preexistentes en HEAD pendientes: notebooks.ts:46, study.ts:17, RequestInfo en test antiguo.

## Sprint 6 retro — 2026-08-23

# Sprint 6 — Convertir Notely en central de operaciones: command palette + dashboard, autosave real, todos con drag&drop y carry-over, y organización con tags, pinned y papelera

- **Status**: closed
- **Started**: 2026-08-23T17:12:26.101Z
- **Ended**: 2026-08-23T18:19:03.532Z
- **Progress**: 0/8 tasks done (0%)

## Tasks

### Backlog (0)

_none_


### To Do (0)

_none_


### In Progress (0)

_none_


### Review (8)

- [high] **TK-29** — Command palette global (Ctrl+K) para buscar notas y ejecutar acciones (agent)
- [high] **TK-30** — Vista Dashboard/Home con resumen del día y de la semana (agent)
- [high] **TK-31** — Autosave con debounce en NoteEditor (agent)
- [medium] **TK-32** — Reorder de todos con drag & drop en WeekView (agent)
- [medium] **TK-33** — Carry-over de todos pendientes entre semanas (agent)
- [medium] **TK-34** — Tags en notas (multi-etiqueta además de cuaderno) (agent)
- [low] **TK-35** — Pinned notes (fijar notas arriba del sidebar) (agent)
- [medium] **TK-36** — Papelera: soft-delete de notas con restore (agent)

### Done (0)

_none_


## Retro

_Pendiente: qué fue bien, qué no, qué mejorar._
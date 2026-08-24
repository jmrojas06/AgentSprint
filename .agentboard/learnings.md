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
- Sprint 7 (Notely) — TS limpio, backup/restore JSON, búsqueda con resaltado + relevancia, IA accionable (study/todos) y chat RAG-lite (/api/ask). CRÍTICO de deploy: el entrypoint ahora lee DATA_DIR (Dockerfile ENV DATA_DIR=/data) — antes la DB vivía en la capa del contenedor y NO en el volumen notely-stack_notely-data; se migró a mano (docker cp → cp al volumen) antes del primer recreate sin pérdida. Deploy automatizado en scripts/deploy.sh: build tag latest+timestamp, safety-backup tar.gz del volumen a /tmp/notely-backups, docker compose up -d --build notely, health check /api/health. Para desplegar: pnpm typecheck && pnpm test && ./scripts/deploy.sh

## Sprint 7 retro — 2026-08-23

# Sprint 7 — Sprint 7 — Deuda técnica (errores TS), backup/restore JSON, búsqueda con resaltado e IA accionable (todos desde notas + chat RAG-lite)

- **Status**: closed
- **Started**: 2026-08-23T18:21:04.530Z
- **Ended**: 2026-08-23T18:50:36.307Z
- **Progress**: 0/5 tasks done (0%)

## Tasks

### Backlog (0)

_none_


### To Do (0)

_none_


### In Progress (0)

_none_


### Review (5)

- [high] **TK-37** — Limpiar errores TypeScript preexistentes del server (agent)
- [high] **TK-38** — Backup/restore JSON completo de la app (agent)
- [medium] **TK-39** — Búsqueda con resaltado de matches y orden por relevancia (agent)
- [medium] **TK-40** — IA accionable: generar todos de la semana desde notas seleccionadas (agent)
- [medium] **TK-41** — Chat RAG-lite: preguntar sobre tus notas (agent)

### Done (0)

_none_


## Retro

_Pendiente: qué fue bien, qué no, qué mejorar._
- Sprint 8 (Notely) — Workspaces completo (TK-42/43/44): aislamiento total por X-Workspace-Id/?workspaceId= con default 'Personal' id=1; delete de workspace MUEVE datos al default en vez de borrarlos. Aprendizajes clave: (1) SQLite NO permite ALTER TABLE ADD COLUMN con NOT NULL DEFAULT + REFERENCES — la FK va solo a nivel lógico; (2) los <a href> de descarga no mandan headers → pasar ?workspaceId= explícito; (3) git: el contenedor del board escribe .agentboard/metrics como root → mantenerlo en .gitignore y fuera del tracking; para mergear cuando un archivo root-owned bloquea el checkout, hacer el merge en un clon temporal (/tmp) y traer los refs con fetch + branch -f/reset --hard. Flujo git acordado: commits por tarea/sprint en develop, merge --no-ff a main solo cuando todo funciona y está desplegado. 20/20 tests, TS limpio web+server, deployado en :4311.

## Sprint 8 retro — 2026-08-23

# Sprint 8 — Sprint 8 — Workspaces: separar empresa/universidad/personal dentro de una sola instancia, con selector global y datos aislados por espacio

- **Status**: closed
- **Started**: 2026-08-23T19:04:36.066Z
- **Ended**: 2026-08-23T20:04:53.246Z
- **Progress**: 0/3 tasks done (0%)

## Tasks

### Backlog (0)

_none_


### To Do (0)

_none_


### In Progress (0)

_none_


### Review (3)

- [high] **TK-42** — Modelo de datos + API multi-workspace (agent)
- [high] **TK-43** — Selector de workspace en UI (header + palette) (agent)
- [medium] **TK-44** — Workspaces en dashboard, semana, palette y backup (agent)

### Done (0)

_none_


## Retro

_Pendiente: qué fue bien, qué no, qué mejorar._
- Sprint 9 (Notely) — adjuntos (POST /api/attachments image/* 10MB servidos en /attachments desde el volumen, paste/drop en editor), quick capture (/api/inbox: primera línea = título; modo captura en palette), import Markdown/Obsidian (/api/import/markdown con frontmatter title/tags y carpetas→notebooks, UI webkitdirectory) y daily notes (/api/daily/:date find-or-create con plantilla y tag #daily). Aprendizajes: (1) Fastify necesita addContentTypeParser para bodies image/* — sin eso responde 415 antes del handler; (2) fastify.inject compara binarios con served.rawPayload, no .body; (3) summary() debe incluir createdAt para filtros por fecha en cliente; (4) curl POST con -H content-type json y body vacío da FST_ERR_CTP_EMPTY_JSON_BODY. Git: al mergear con archivos root-owned bloqueantes, clonar a /tmp, mergear allí y sincronizar refs con fetch + branch -f + push. 26/26 tests, deployado y verificado en :4311 (daily idempotente e inbox probados en vivo).

## Sprint 9 retro — 2026-08-24

# Sprint 9 — Sprint 9 — Local-first power: adjuntos/imágenes en notas, quick capture con inbox, import de carpetas Markdown/Obsidian y daily notes

- **Status**: closed
- **Started**: 2026-08-23T23:54:43.204Z
- **Ended**: 2026-08-24T00:37:09.955Z
- **Progress**: 0/4 tasks done (0%)

## Tasks

### Backlog (0)

_none_


### To Do (0)

_none_


### In Progress (0)

_none_


### Review (4)

- [high] **TK-45** — Adjuntos: imágenes pegadas/drag & drop en notas (human)
- [medium] **TK-46** — Quick capture: POST /api/inbox + captura desde palette (agent)
- [medium] **TK-47** — Import de carpetas Markdown/Obsidian (human)
- [high] **TK-48** — Daily notes: nota del día con plantilla (agent)

### Done (0)

_none_


## Retro

_Pendiente: qué fue bien, qué no, qué mejorar._
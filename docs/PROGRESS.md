# AgentSprint — Progress log

> Documento vivo. Actualizar después de cada sesión de trabajo.
> Estado global: **Fase 1-3 en `main` (fases 2-3 + brand kit mergeados el 16-ago) · Fase 4+ en curso**

> ⚠️ Regla: `main` = estable. Trabajar en ramas `feat/*`. Merge solo con typecheck/test/build verdes.

## Cómo trabajar aquí (flujo sugerido)

1. `git checkout main` → `git pull` (lo último estable).
2. `git checkout -b feat/<algo>` para cada feature.
3. Antes de terminar la sesión: `pnpm typecheck && pnpm test && pnpm build`, actualizar ESTE archivo y hacer commit.
4. Al terminar la feature, merge a `main`.

---

## Estado por fases

### ✅ Fase 1 — Core (COMPLETADA)
- Monorepo pnpm (core / server / web / cli), CI GitHub Actions.
- `packages/core`: modelo de dominio Zod + storage git-nativo (`.agentboard/tasks/*.md`, `sprints/sprint-N.md`, `config.yaml`).
  - `ProjectStore.init/open`, CRUD de tareas y sprints, activación/demote de sprint activo, `AGENTS.md` generado.
- `packages/server`: Fastify.
  - REST: `/api/project`, `/api/tasks`, `/api/sprints`, `/api/config`, `/api/health`.
  - SSE `/api/events` (broadcast de cambios) + file-watcher (chokidar) → sync en vivo.
  - Índice SQLite con `node:sqlite` (cero deps nativas) + fallback en memoria. Busca por `q`, filtra `status`, `sprint`, `assignee`.
  - Sirve el build estático del web + SPA fallback.
- `packages/web`: React 19 + Vite 6 + Tailwind 4.
  - Kanban por columnas (configurable), panel de sprints (crear/activar/cerrar), búsqueda, filtro por sprint, modal de edición completa, modal de creación.
- `packages/cli`: binario `agentboard` (`init` / `serve [--port --host --no-open --init]`), abre navegador, resuelve `web/dist`.
- Tests: core 7, server 7 (vitest). Typecheck y build verdes en los 4 paquetes.
- README + LICENSE (MIT) + `.gitignore` + CI.

### 🚧 Fase 2 — Sprint engine (PARCIAL, en rama `feat/mcp`)
- [x] Activar/cerrar sprint (ya en Fase 1).
- [x] Stats por sprint: total, done, puntos, % completado — endpoint `GET /api/sprints/:id/stats` + `GET /api/stats`, barra de progreso en el panel de sprints.
- [ ] Burndown temporal (por día).
- [ ] Retro / learnings: archivo `memory/` para el siguiente sprint.

### ✅ Fase 3 — Integración con agentes (EN CURSO, rama `feat/mcp`)
- [x] `AGENTS.md` generado por `init` (cualquier agente entiende el workflow).
- [x] **Servidor MCP** (`packages/mcp`): 12 tools (`board_summary`, `task_list`, `task_get`, `task_create`, `task_update`, `task_status`, `task_claim`, `task_spec`, `sprint_current`, `sprint_list`, `sprint_activate`, `brand_get`). Transporte stdio, `--root <dir>` o `AGENTSPRINT_ROOT`. 11 tests verdes.
- [x] **Spec export**: `buildTaskSpec()` en core + `GET /api/tasks/:id/spec` + CLI `agentboard spec <dir> TK-N` + botón "Copy spec" en el modal.
- [x] **Brand kit** (`.agentboard/brand.md`): identidad, colores/fuentes, archivos de diseño y reglas de marca.
  - Core: schema Zod `Brand`/`BrandAsset`, `emptyBrand()`/`hasBrand()`, `ProjectStore.getBrand()`/`updateBrand()` (merge+parse+write+emit), inyección en `buildTaskSpec()` vía `buildBrandSection()` (solo si `hasBrand()`).
  - Server: `GET/PUT /api/brand` (+ broadcast SSE) y brand en `/api/project`; el spec de `/api/tasks/:id/spec` lo incluye.
  - Web: `BrandPanel` (tabs Sprints | Brand en sidebar) con identidad, color pickers, fuentes, assets y guidelines.
  - CLI: `agentboard brand [dir]` imprime el brand / avisa si no hay.
  - MCP: tool `brand_get`; `task_spec` inyecta brand.
  - Tests: core 17, mcp 11, server 11, cli 4 (43 total).
- [x] `docs/mcp.md` con setup para opencode / Claude Code / Cursor.
- [x] **Probar el flujo de verdad con un agente (opencode) sobre un repo real**: Notely (`github.com/jmrojas06/notely`). Sprints 1-2 completos vía board (10 tareas), encontrando 2 bugs (parse warnings, `node:sqlite`+tsup) — ambos arreglados en `main`.
- [x] **MCP sobre HTTP** (`serve --mcp`): el board ahora expone `POST/GET/DELETE /mcp` (Streamable HTTP) en el mismo puerto que la UI — cualquier agente MCP se conecta por URL, sin proceso aparte. Implementado con `WebStandardStreamableHTTPServerTransport` + conversión a Fastify (una sesión = un `McpServer`, porque el Protocol del SDK es single-connection). Test: initialize → 202 → tools/list (12 tools). Claves: `sessionIdGenerator` para sesiones, `enableJsonResponse` para respuestas JSON cerradas (el modo SSE mantiene el stream abierto y cuelga a `inject`), y el cliente debe mandar `Accept: application/json, text/event-stream`.
- [x] **Warnings de parseo expuestos**: `GET /api/project` ahora incluye `warnings` (`ProjectStore.lastWarnings`) y `board_summary` del MCP avisa con un campo `warnings`. Tests añadidos (server + mcp).
- [x] **Board propio de AgentSprint** (dogfooding): `.agentboard/` con sprint "Robustez + conectividad" (AS-1 warnings, AS-2 MCP-over-HTTP). El propio repo se gestiona con su board.
- [x] **Docker**: `Dockerfile` multi-stage (build monorepo → run `agentboard serve`). `docker-compose.yml` en `~/Documents/proyects/` orquesta 3 servicios siempre activos (`restart: always`): `board` (Notely, :4310), `boardsprint` (AgentSprint self-host, :4312) y `notely` (app :4311, un contenedor sirve web+API con `@fastify/static`). Ambos boards con `--mcp`. `opencode.json` de los dos repos apunta al MCP **remoto** por URL.
- [x] **Multi-proyecto (AS-3)**: un solo `agentboard serve <base>` descubre todos los proyectos (carpetas con `.agentboard/`) bajo una carpeta base y no mezcla nada.
  - `ProjectManager` (`packages/server/src/projects.ts`) abre un store+index+broadcast+watcher por proyecto (lazy por nombre).
  - API: `GET /api/projects` + todas las rutas se resuelven por `?project=<name>` (default = primer proyecto por orden alfabético). `/api/project` sigue igual.
  - MCP: nuevas tools `project_list`, `project_current`, `project_use` — el agente **fija el proyecto activo** y todas las demás tools operan sobre él (estado por sesión). `board_summary` refleja el proyecto activo.
  - UI: selector de proyecto en el header (solo visible con >1 proyecto); todos los fetch llevan `?project=`.
  - Compose actualizado: **un solo contenedor `board`** monta `~/Documents/proyects` en `/projects` y sirve `notely` + `AgentSprint` (UI y `/mcp` en :4310). Se eliminó `boardsprint` (:4312). Ambos `opencode.json` apuntan a `http://127.0.0.1:4310/mcp`.
  - Tests: 49 verdes (core 18, mcp 12, server 15 incl. descubrimiento/`?project=`/`project_use`, cli 4).
- [x] **Mejoras de uso (AS-4)**: burndown, drag & drop, banner de warnings, reporte de sprint.
  - **Burndown**: `packages/server/src/metrics.ts` registra un snapshot diario del sprint activo en `.agentboard/metrics/sprint-<id>.json` (dedup por fecha; sobrevive reinicios). `GET /api/sprints/:id/burndown` + mini-chart SVG en `SprintPanel` (línea ideal punteada + línea real).
  - **Drag & drop**: mover tareas entre columnas del kanban con HTML5 DnD (`Board.tsx`), highlight de columna al arrastrar.
  - **Banner de warnings**: los archivos no parseables se muestran en la UI (dismissible), antes solo vía API/MCP.
  - **Reporte**: `GET /api/sprints/:id/report` → Markdown (goal, fechas, stats, tareas por estado, sección retro) + botón de descarga `.md`.
  - Tests: 51 verdes (core 18, mcp 12, server 17, cli 4).

### ⬜ Fase 4 — Pulido
- Review gates, grafo de dependencias, activity log, temas claro/oscuro.

### ⬜ Fase 5 — Release
- Publicar a npm (`changesets`), Docker multi-stage + compose, docs site (Vitepress), demo GIF en README.

---

## Bugs conocidos / cosas a vigilar

1. **ID de tarea fijo vs automático**: `createTask` acepta `id` explícito; si alguien crea manualmente `TK-99` y luego una tarea auto, el auto-id puede colisionar. `_bumpTaskMax` mitiga tras `_load`, pero no tras un `createTask` con `id` manual post-carga. (Menor.)
2. **El SSE y el watcher se activan en `buildApp`** — en tests se crea un watcher por test; cerrar bien con `close()` (ya se hace en afterEach). Si se abren muchos servers en dev, se acumulan watchers. (Menor.)
3. **`@fastify/static` con `index: 'index.html'`**: el fallback SPA usa `setNotFoundHandler`; rutas tipo `/api/*` inexistentes devuelven 404 JSON. Verificado OK.
4. **pnpm 11**: los settings viven en `pnpm-workspace.yaml` (no en `package.json`). `onlyBuiltDependencies: [esbuild]` ya está. Si se añade alguna dep con postinstall, hay que aprobarla ahí.
5. **`node:sqlite`**: requiere Node ≥ 22.5 (en CI se usa Node 22). En Node 20 cae al índice en memoria (ok).
6. **CLI `serve` con puerto ocupado**: imprime `EADDRINUSE` y sale con el error; UX a mejorar (buscar puerto libre).
7. **SDK MCP v1.30**: `InMemoryTransport.createLinkedPair()` devuelve una **tupla** `[clientTransport, serverTransport]` (no `{client, server}`). Y el orden importa: conectar el server ANTES que el client. Ver `packages/mcp/src/mcp.test.ts`.
8. **MCP `task_create`**: si el `sprint` indicado no existe, devuelve error en texto (no lanza) — comportamiento intencionado para que el agente vea el motivo. Revisar que no haya campos `sprint` obsoletos.
9. **El server y el CLI están desacoplados del MCP**: hoy hay que correr el MCP aparte. Pendiente opción `agentboard serve --mcp` para un solo proceso.
10. **Brand**: `.agentboard/brand.md` guarda `guidelines` en el body markdown y el resto en frontmatter. El template de init usa un comentario HTML `<!-- -->` (se filtra al leer) para que un board fresco NO se considere "con brand" y no se inyecten instrucciones placeholder en los specs.
11. **`main()` a nivel de módulo**: en `cli` y `mcp` se invoca solo si es el entry point real (`import.meta.url === pathToFileURL(process.argv[1]).href`), para que importar los módulos en tests no dispare `process.exit`. Ya blindado en ambos.
12. **CLI sin tests históricos**: se añadió `packages/cli/src/cli.test.ts` (parseArgs + cmdBrand). `console.log` no pasa por `process.stdout.write` en vitest → en CLI usar `process.stdout.write` para salida testeable.
13. **Tareas que se caen en silencio si el frontmatter YAML no parsea**: un `title: Web: foo` SIN comillas rompe js-yaml (`: ` prohibido en scalars planos) → la tarea desaparece del board sin aviso. Detectado probando Notely. ✅ **Arreglado en `main`**: `ProjectStore.lastWarnings` + `console.warn` en `_load` (el archivo sigue en disco, no se borra). Al crear tareas vía API/UI el serializer comillas solo, así que solo afecta a archivos escritos a mano. Mejora pendiente: exponer warnings en `/api/project`.
14. **`node:sqlite` se rompe al buildea con tsup/esbuild**: esbuild no conoce `node:sqlite` como builtin y reescribe el import a `sqlite` (bare) → en el `dist` compilado el índice SQLite fallaba en silencio y caía al fallback en memoria. Detectado al probar Notely (allí era crítico). ✅ **Arreglado en `main`** (`packages/server/src/indexdb.ts`): `createRequire(import.meta.url)` + `require('node:sqlite')`, que esbuild no reescribe. Test de regresión: `createIndex()` con `dbPath` de archivo crea el `.db` real (server tests 12).

---

## Comandos útiles

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm agentsprint init <dir>      # o: node packages/cli/dist/index.js init <dir>
pnpm agentsprint serve <dir>     # arranca todo en http://127.0.0.1:4310
# dev con hot-reload:
pnpm --filter @agentsprint/server dev   # terminal 1 (tsup watch)
pnpm --filter @agentsprint/web dev      # terminal 2 (vite, proxy /api -> 4310)
```

## Stack / estructura

```
packages/
├── core/    # dominio + storage .md  (@agentsprint/core)
├── server/  # Fastify REST+SSE+watcher+sqlite (@agentsprint/server)
├── web/     # React+Vite+Tailwind UI        (@agentsprint/web)
├── cli/     # binario `agentboard`          (@agentsprint/cli)
└── mcp/     # servidor MCP para agentes     (@agentsprint/mcp) ✅ creado
```

## Convenciones

- TypeScript estricto, Zod para validar todo lo que entra por frontera.
- Storage: los archivos `.md` son la fuente de verdad; la UI y el MCP solo los reflejan.
- Nunca se elimina una tarea del historial sin que sea explícito.
- Commits en inglés, prefijo conventional (`feat:`, `fix:`, `docs:`).

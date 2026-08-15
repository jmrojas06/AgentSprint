# AgentSprint — Progress log

> Documento vivo. Actualizar después de cada sesión de trabajo.
> Estado global: **Fase 1 completa (main) · Fase 2-3 en curso (rama `feat/mcp`)**

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

### 🚧 Fase 3 — Integración con agentes (EN CURSO, rama `feat/mcp`)
- [x] `AGENTS.md` generado por `init` (cualquier agente entiende el workflow).
- [x] **Servidor MCP** (`packages/mcp`): 11 tools (`board_summary`, `task_list`, `task_get`, `task_create`, `task_update`, `task_status`, `task_claim`, `task_spec`, `sprint_current`, `sprint_list`, `sprint_activate`). Transporte stdio, `--root <dir>` o `AGENTSPRINT_ROOT`. 9 tests verdes.
- [x] **Spec export**: `buildTaskSpec()` en core + `GET /api/tasks/:id/spec` + CLI `agentboard spec <dir> TK-N` + botón "Copy spec" en el modal.
- [x] `docs/mcp.md` con setup para opencode / Claude Code / Cursor.
- [ ] Probar de verdad el flujo MCP con un agente (opencode) sobre un repo real.
- [ ] Auto-conectar el MCP en `agentboard serve` (opción `--mcp`).

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

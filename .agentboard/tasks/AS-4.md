---
id: AS-4
title: 'Mejoras de uso — burndown, drag & drop, banner de warnings, reporte'
status: Done
sprint: 1
priority: medium
assignee: agent
estimate: 6
tags:
  - server
  - web
dependencies: []
createdAt: '2026-08-18T16:00:00.000Z'
updatedAt: '2026-08-21T14:50:59.945Z'
---
## Description

Cuatro mejoras de uso del board:

1. **Burndown**: snapshots diarios del sprint activo en
   `.agentboard/metrics/sprint-<id>.json` (dedup por día, sobreviven reinicios)
   + `GET /api/sprints/:id/burndown` + mini-chart SVG en el panel de sprints
   (línea ideal punteada + línea real).
2. **Drag & drop**: mover tareas entre columnas del kanban (HTML5 DnD).
3. **Banner de warnings**: los archivos no parseables se muestran en la UI
   (antes solo vía API/MCP), con dismiss.
4. **Reporte de sprint**: `GET /api/sprints/:id/report` genera un Markdown
   (goal, fechas, stats, tareas por estado, sección retro) y botón de descarga.

## Acceptance criteria

- [ ] Snapshot de burndown diario y endpoint `GET /api/sprints/:id/burndown`
- [ ] Gráfico de burndown en el panel de sprints
- [ ] Drag & drop entre columnas del kanban
- [ ] Banner de warnings en la UI con dismiss
- [ ] Reporte de sprint descargable en Markdown
- [ ] Tests: burndown (snapshot + endpoint) y reporte

---
id: AS-5
title: Herramientas MCP de ciclo de vida de sprint y borrado de tareas
status: Done
sprint: 2
priority: high
assignee: agent
estimate: 3
tags:
  - mcp
  - server
dependencies: []
createdAt: '2026-08-20T16:45:00.000Z'
updatedAt: '2026-08-21T14:51:00.148Z'
---
## Description

Permitir que los agentes gestionen el ciclo completo de sprints y tareas desde MCP:
crear nuevos sprints (`sprint_create`), cerrar sprints activos (`sprint_close`),
obtener el reporte Markdown de un sprint (`sprint_report`) y eliminar tareas
creadas por error (`task_delete`).

## Acceptance criteria

- [ ] MCP tool `sprint_create` crea un sprint con `goal` y estado opcional
- [ ] MCP tool `sprint_close` cierra el sprint especificado (o el activo) y fija `endedAt`
- [ ] MCP tool `sprint_report` devuelve el reporte Markdown formateado del sprint
- [ ] MCP tool `task_delete` elimina una tarea por ID
- [ ] Tests en `@agentsprint/mcp` verificando el funcionamiento de las 4 tools

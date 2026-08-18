---
id: AS-3
title: Multi-proyecto: un server sirve varios proyectos con selector
status: Review
sprint: 1
priority: high
assignee: agent
estimate: 8
tags:
  - server
  - mcp
  - web
dependencies: []
createdAt: '2026-08-18T12:00:00.000Z'
updatedAt: '2026-08-18T15:00:00.000Z'
---
## Description

Que un solo `agentboard serve <base>` descubra todos los proyectos (carpetas
con `.agentboard/`) bajo una carpeta base, sin mezclar cosas. La UI muestra un
selector de proyecto y el MCP es multi-proyecto.

El MCP sabe en qué proyecto trabaja el agente: expone `project_list`,
`project_current` y `project_use` para fijar el proyecto activo; las tareas
operan sobre él.

## Acceptance criteria

- [ ] `ProjectManager` descubre proyectos (dir con `.agentboard`) bajo el base dir
- [ ] `serve <dir>` sigue funcionando cuando `<dir>` mismo tiene `.agentboard` (1 proyecto)
- [ ] `GET /api/projects` lista los proyectos (nombre, rootDir, configName)
- [ ] Las rutas existentes se resuelven por `?project=` (default = primer proyecto)
- [ ] UI: selector de proyecto en el header; los datos del proyecto activo
- [ ] MCP: `project_list`, `project_current`, `project_use`; `board_summary` indica proyecto
- [ ] Tests (descubrimiento, API multi-proyecto, MCP project tools)
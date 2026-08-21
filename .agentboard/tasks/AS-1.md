---
id: AS-1
title: Exponer warnings de parseo en /api/project
status: Done
sprint: 1
priority: high
assignee: agent
estimate: 1
tags:
  - core
  - server
dependencies: []
createdAt: '2026-08-16T19:22:00.000Z'
updatedAt: '2026-08-21T14:50:59.360Z'
---
## Description

`ProjectStore.lastWarnings` ya existe (fix de tareas que se caen en silencio
cuando su frontmatter YAML no parsea), pero la API no lo expone: el usuario no
se entera desde la web ni desde el MCP de que hay archivos que no se pudieron
leer.

## Acceptance criteria

- [ ] `GET /api/project` incluye un campo `warnings` con los mensajes de `lastWarnings`
- [ ] El MCP tool `board_summary` (o `task_list`) avisa si hay warnings
- [ ] Test que verifique ambos

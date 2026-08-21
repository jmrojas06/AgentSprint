---
id: AS-6
title: Herramientas MCP para checklists y notas de ejecución
status: Done
sprint: 2
priority: high
assignee: agent
estimate: 3
tags:
  - mcp
  - core
dependencies: []
createdAt: '2026-08-20T16:45:00.000Z'
updatedAt: '2026-08-21T14:51:00.430Z'
---
## Description

Proveer herramientas granulares para que los agentes marquen criterios de aceptación
completados individualmente (`task_checklist`) y agreguen bitácoras/notas de progreso
o decisiones técnicas (`task_note`) en el cuerpo del archivo Markdown sin sobreescribir
la descripción.

## Acceptance criteria

- [ ] MCP tool `task_checklist` para marcar/desmarcar un criterio por índice o texto (`- [ ]` <-> `- [x]`)
- [ ] MCP tool `task_note` para anexar una nota con timestamp bajo `## Notes` en el cuerpo de la tarea
- [ ] Los cambios se persisten en el archivo Markdown `.agentboard/tasks/TK-N.md`
- [ ] Tests unitarios en `@agentsprint/core` y `@agentsprint/mcp`

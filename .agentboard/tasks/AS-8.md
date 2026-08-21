---
id: AS-8
title: Grafo de dependencias y validación de bloqueos
status: Done
sprint: 3
priority: high
assignee: agent
estimate: 4
tags:
  - core
  - mcp
dependencies: []
createdAt: '2026-08-20T16:45:00.000Z'
updatedAt: '2026-08-21T14:51:01.213Z'
---
## Description

Validar y hacer cumplir el grafo de dependencias entre tareas. Si una tarea depende de
otra que no está `Done`, se considera bloqueada. Detectar ciclos y advertir/rechazar
cuando un agente intente reclamar una tarea bloqueada (`task_claim`) a menos que use `force: true`.

## Acceptance criteria

- [ ] Detección de ciclos de dependencias en `ProjectStore`
- [ ] Función helper `isTaskBlocked(task, allTasks)` y `getBlockers(task, allTasks)` en `@agentsprint/core`
- [ ] `task_claim` en MCP advierte o falla si la tarea está bloqueada (con parámetro opcional `force`)
- [ ] `task_spec` incluye la lista de dependencias y su estado
- [ ] Tests para dependencias circulares y bloqueo de reclamos

---
id: AS-9
title: Memoria persistente de aprendizajes y retrospectivas de sprint
status: Done
sprint: 3
priority: medium
assignee: agent
estimate: 3
tags:
  - core
  - server
  - mcp
dependencies:
  - AS-8
createdAt: '2026-08-20T16:45:00.000Z'
updatedAt: '2026-08-21T14:51:01.299Z'
---
## Description

Crear un almacenamiento de aprendizajes y retrospectivas en `.agentboard/memory/` o
`.agentboard/learnings.md`. Al cerrar un sprint o registrar aprendizajes, las reglas
o conclusiones clave quedan persistidas y pueden ser inyectadas en los prompts de
especificación de tareas (`task_spec`) de futuros sprints.

## Acceptance criteria

- [ ] Almacenamiento y parser de aprendizajes/retrospectivas en `@agentsprint/core`
- [ ] Endpoint `GET/PUT /api/memory` para consultar y editar aprendizajes
- [ ] Inyección opcional de aprendizajes en `buildTaskSpec`
- [ ] Tool MCP `learnings_get` y `learnings_append`
- [ ] Tests que validen persistencia y generación de specs

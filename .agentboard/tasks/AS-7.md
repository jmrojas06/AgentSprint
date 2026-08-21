---
id: AS-7
title: Edición de Brand y registro de Prompts y Recursos MCP
status: Done
sprint: 2
priority: medium
assignee: agent
estimate: 4
tags:
  - mcp
  - core
dependencies:
  - AS-5
createdAt: '2026-08-20T16:45:00.000Z'
updatedAt: '2026-08-21T14:51:00.638Z'
---
## Description

Ampliar la integración MCP con soporte para actualizar la marca (`brand_update`), y
registrar Recursos MCP (`agentboard://tasks`, `agentboard://sprint/current`, `agentboard://brand`)
y Prompts MCP (`execute-task`, `sprint-planning`, `sprint-retro`) según el estándar MCP.

## Acceptance criteria

- [ ] MCP tool `brand_update` para actualizar tokens y guidelines de `.agentboard/brand.md`
- [ ] Recursos MCP registrados con schemas URI para tareas, sprint activo y brand
- [ ] Prompts MCP registrados para guiar flujos de trabajo estandarizados
- [ ] Tests en `@agentsprint/mcp`

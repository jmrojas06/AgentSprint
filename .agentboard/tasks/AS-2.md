---
id: AS-2
title: MCP sobre HTTP en el mismo server (serve --mcp)
status: Done
sprint: 1
priority: high
assignee: agent
estimate: 3
tags:
  - mcp
  - server
dependencies: []
createdAt: '2026-08-16T19:22:00.000Z'
updatedAt: '2026-08-21T14:50:59.706Z'
---
## Description

Hoy el MCP corre como proceso aparte por stdio. Para que cualquier agente se
conecte "con la URL del board" sin procesos extra, exponer el servidor MCP
sobre **Streamable HTTP** en la misma instancia Fastify (`POST /mcp`), activado
con `agentboard serve --mcp` o siempre disponible.

## Acceptance criteria

- [ ] `POST /mcp` responde a `initialize` y `tools/list` (streamable HTTP del SDK MCP)
- [ ] `agentboard serve --mcp <dir>` expone `/mcp` en el mismo puerto que la UI
- [ ] Test con el cliente MCP que liste las 12 tools
- [ ] Documentar cómo conectar opencode/Claude/Cursor por URL

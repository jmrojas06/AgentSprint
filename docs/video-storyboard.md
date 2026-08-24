# Storyboard – Demo en video de AgentSprint (Perfil 1: Dev solo con agentes de IA)

## Resumen del video
- **Duración:** 45–60 segundos
- **Formato:** 1920×1080, 30 fps
- **Idioma:** Spanish (overlays + voiceover opcional)
- **Objetivo:** Mostrar el flujo completo desde un repo vacío hasta que un agente reclama y trabaja una tarea

## Guía de escenas (6 escenas)

### Escena 1 – Intro (0:00–0:05)
- **Visual:** Fondo oscuro/terminal, título sobreimpreso emergente.
- **Overlaid text (ES):** "AgentSprint – Kanban git‑native para devs y agentes de IA"
- **Voiceover (opcional):** "AgentSprint: tus tareas viven en Markdown dentro del repo, y los agentes las trabajan en sprints."
- **Objetivo:** Capturar la atención y comunicar el valor en los primeros 3 segundos.

### Escena 2 – CLI init (0:05–0:12)
- **Visual:** Terminal visible, comando y salida.
- **Command shown:** `npx @jmrojas06/agentsprint-cli init`
- **Output highlighted:** Archivos creados en `.agentboard/`, `AGENTS.md`, sprints de ejemplo.
- **Overlaid text (ES):** "Inicializa `.agentboard/` con tareas y sprints de ejemplo."
- **Objetivo:** Mostrar el punto de entrada principal y qué crea.

### Escena 3 – Board creado (0:12–0:18)
- **Explorador de archivos:** Zoom rápido a `.agentboard/`.
- **Mostrar:** `AGENTS.md`, `config.yaml`, `tasks/TK-1.md` (YAML + cuerpo Markdown).
- **Overlaid text (ES):** "Tareas Markdown + YAML, versionadas con tu código."
- **Objetivo:** Que el usuario vea dónde viven los datos y su formato.

### Escena 4 – Servidor y UI (0:18–0:28)
- **Visual 1:** Terminal con `npx @jmrojas06/agentsprint-cli serve`.
- **Visual 2:** Navegador abriendo `http://127.0.0.1:4310`.
- **UI:** Cuadro Kanban con columnas, una tarjeta de tarea en "To Do", filtros visibles.
- **Overlaid text (ES):** "Servidor local + UI Kanban lista para usar."
- **Objetivo:** Mostrar que el board ya es usable visualmente.

### Escena 5 – MCP server (0:28–0:38)
- **Terminal:** `npx -y @jmrojas06/agentsprint-mcp --root /ruta/al/proyecto`.
- **Overlaid text (ES):** "Servidor MCP: agentes leen y modifican el board con herramientas."
- **Optional:** Si se puede, mostrar la salida del MCP server iniciándose.

### Escena 6 – Agente trabajando (0:38–0:55)
- **Vista MCP (simulada o real):** Ejecutar `task_claim` sobre una tarea.
- **Acciones mostradas:**
  1. `task_claim` — el agente reclama la exclusiva.
  2. `task_checklist` — marcar un criterio de aceptación (`[x]`).
  3. Mover la tarjeta de "In Progress" a "Review".
- **Overlaid text (ES):** "El agente reclama trabajo, marca criterios; tú decides cuándo está Done."
- **Objetivo:** Mostrar el ciclo agente + human-in-the-loop.

### Escena 7 – Cierre (0:55–1:00)
- **Visual:** Pantra final con mensaje y comandos.
- **Overlaid text (ES):** "Tu tablero es una carpeta en Git. Instala AgentSprint y deja que tus agentes trabajen con contexto persistente."
- **Command shown:** `npx @jmrojas06/agentsprint-cli init`
- **URL:** https://jmrojas06.github.io/AgentSprint/
- **Objetivo:** Llamada a la acción clara y recordatorio del valor.

## Flujo de transición entre escenas
- Escena 1 → 2: El título desaparece y aparece el ícono de terminal.
- Escena 2 → 3: La salida del comando "desliza" hacia el explorador de archivos.
- Escena 3 → 4: El explorador se cierra y aparece la ventana del navegador.
- Escena 4 → 5: La terminal reaparece con el comando MCP.
- Escena 5 → 6: El agente reclama una tarea (animation simple o captura de pantalla).
- Escena 6 → 7: La vista MCP se desvanece y aparece el mensaje final.

## Notas de producción
- Usar capturas de pantalla reales de la UI siempre que sea posible (terminal, navegador).
- Los comandos deben ser exactamente los del README para evitar confusiones.
- Si no se puede grabar pantalla real, usar animaciones simples con flechas y resaltados.
- El audio (voiceover) debe ser claro, ritmo moderado, sin jergas innecesarias.
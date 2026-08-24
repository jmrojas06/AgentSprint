# Guion de voz / overlays en español – Demo de AgentSprint

## Notación
- **[VISUAL X]**: Lo que aparece en pantalla en el segundo X.
- **[OVERRIDE X]**: Texto sobreimpreso que aparece en el segundo X.
- **[AUDIO X]**: Lo que se escucha (voiceover o efectos) en el segundo X.
- Todos los tiempos son aproximados para un video de 45–60 seg.

---

### Segundo 0:00 – Segundo 0:05  (Intro)
- **[VISUAL 0-5]** Fondo oscuro con el logotipo o nombre "AgentSprint" centrado.
- **[OVERRIDE 0-5]** "AgentSprint – Kanban git‑native para devs y agentes de IA"
- **[AUDIO 0-5]** Voiceover (opcional): "AgentSprint: tus tareas viven en Markdown dentro del repo, y los agentes las trabajan en sprints."
- **[NOTAS]** Este es el "hook" de 3 segundos. El texto debe ser grande y de alto contraste.

---

### Segundos 0:05 – 0:12  (CLI init)
- **[VISUAL 5-12]** Terminal visible a la izquierda, cursor parpadeando.
- **[OVERRIDE 5-12]** Línea de comando: `npx @jmrojas06/agentsprint-cli init`
- **[AUDIO 5-12]** Voiceover: "Para comenzar, iniciamos el board con el CLI de AgentSprint."
- **[AUDIO adicional]** (opcional) Sonido de "enter" al ejecutar el comando.
- **[NOTAS]** El terminal debe mostrar la salida relevante: archivos creados, "3 new tasks", etc.

---

### Segundos 0:12 – 0:18  (Board creado)
- **[VISUAL 12-18]** Explorador de archivos (macOS/Windows/Linux — el que más se use en el demo).
- **[OVERRIDE 12-18]** Zoom rápido a la carpeta `.agentboard/`.
- **Mostrar en el zoom:**
  - `AGENTS.md` (primeras líneas: instrucciones para el agente).
  - `config.yaml` (mostrar `statuses:` o `name:`).
  - `tasks/TK-1.md` (primera línea: `---`, `id: TK-1`, `title:`, `status: To Do`, el YAML).
- **[OVERRIDE 12-18]** Texto pequeño pero legible: "Tareas Markdown + YAML, versionadas con tu código."
- **[AUDIO 12-18]** Voiceover: "AgentSprint guarda el trabajo donde vive el código: tareas Markdown con frontmatter, versionadas con Git."
- **[NOTAS]** Este es el "show the data layer" — el usuario entiende dónde están los datos.

---

### Segundos 0:18 – 0:28  (Servidor y UI)
- **[VISUAL 18-28]** Dos paneles o corte rápido:
  - Izquierda: Terminal con `npx @jmrojas06/agentsprint-cli serve`.
  - Derecha: Navegador que carga `http://127.0.0.1:4310`.
- **[OVERRIDE 18-28]** En el navegador: la UI Kanban con columnas ("To Do", "In Progress", "Review", "Done"), una tarjeta en la columna "To Do" con el título de la tarea creada.
- **[AUDIO 18-28]** Voiceover: "El servidor inicia la UI y la API REST en http://127.0.0.1:4310. El board está listo para usarse."
- **[NOTAS]** Este es el momento "¡mira ya funciona!". La UI debe verse profesional y funcional.

---

### Segundos 0:28 – 0:38  (MCP server)
- **[VISUAL 28-38]** Terminal centrada.
- **[OVERRIDE 28-38]** `npx -y @jmrojas06/agentsprint-mcp --root /ruta/al/proyecto`
- **[AUDIO 28-38]** Voiceover: "Para que un agente de IA trabaje el board, levantamos el servidor MCP. Este ejemplos usa stdio con el paquete `agentsprint-mcp`."
- **[OPcional]** Mostrar las 28 herramientas expuestas (board_summary, task_claim, etc.) como una lista rápida o solo mencionar "task_claim" y "task_checklist".
- **[NOTAS]** Este paso conecta el board con el agente. El flag `-y` evita prompts interactivos.

---

### Segundos 0:38 – 0:55  (Agente trabajando)
- **[VISUAL 38-55]** Simulación de la interacción del agente o captura real de herramientas MCP.
- **Paso 1 (segundo 38-41):** Ejecutar `task_claim` sobre la tarea TK-1. Override: "task_claim: el agente reclama la tarea en exclusiva."
- **Paso 2 (segundo 41-44):** Ejecutar `task_checklist` para marcar un criterio. Override: "task_checklist: marcar `[x]` un criterio de aceptación."
- **Paso 3 (segundo 44-47):** Mover la tarjeta de la columna "In Progress" a "Review". Override: "Mover a Review: el agente avanza el status; tú decides cuándo está Done."
- **Paso 4 (segundo 47-55):** Vista de la tarjeta en "Review" con los checklist tiqueados y una nota de ejecución. Override: "El agente deja notas; tú revisas y cierras la sprint."
- **[OVERRIDE 38-55]** Breves etiquetas que aparezcan y desaparezcan: "Claim", "Checklist", "Review", "Done".
- **[AUDIO 38-55]** Voiceover: "El agente reclama trabajo, marca criterios y deja notas. Tú revisas y decides qué es Done. Tu tablero versiona todo con Git."
- **[NOTAS]** Este es el corazón del video: el flujo agente + human. Si no se pueden grabar herramientas reales, usar animaciones con flechas y resaltados sobre capturas de la UI.

---

### Segundos 0:55 – 1:00  (Cierre)
- **[VISUAL 55-60]** Pantalla negra o el fondo del logo AgentSprint.
- **[OVERRIDE 55-60]** "Tu tablero es una carpeta en Git. Instala AgentSprint y deja que tus agentes trabajen con contexto persistente."
- **[OVERRIDE 55-58]** (línea inferior) `npx @jmrojas06/agentsprint-cli init`
- **[OVERRIDE 55-57]** (URL en pequeño) https://jmrojas06.github.io/AgentSprint/
- **[AUDIO 55-60]** Voiceover (o texto en pantalla): "Tu tablero es una carpeta en Git. Instala AgentSprint y deja que tus agentes trabajen con contexto persistente."
- **[NOTAS]** Llamada a la acción clara. El usuario sabe qué comando ejecutar a continuación y dónde encontrar docs.

---

## Resumen rápido del guion (solo texto)

1. "AgentSprint – Kanban git‑native para devs y agentes de IA."
2. "npx @jmrojas06/agentsprint-cli init — inicializa .agentboard/ con tareas y sprints."
3. "Tareas Markdown + YAML, versionadas con tu código."
4. "npx @jmrojas06/agentsprint-cli serve — servidor local + UI Kanban."
5. "npx -y @jmrojas06/agentsprint-mcp --root /ruta/al/proyecto — servidor MCP."
6. "El agente reclama trabajo, marca criterios y deja notas. Tú decides cuándo está Done."
7. "Tu tablero es una carpeta en Git. npx @jmrojas06/agentsprint-cli init."

## Tono y estilo
- **Directo, técnico, sin marketing exagerado.**
- Frases cortas. Sin "revolucionario", "mágico", "transformador" a menos que sea cierto y comprobado.
- Usar el lenguaje del propio producto: "frontmatter", "YAML", "sprint", "checklist", "claim", "review", "Done".
- Español neutral pero con terminología técnica consistente (evitar anglicismos innecesarios si hay término en español claro: "tablero" en lugar de "board" en el voiceover, aunque en los overlays está bien usar el término original).

## Recursos necesarios
- Grabadora de pantalla (Linux: `ffmpeg -f x11grab`, macOS: `QuickTime`, Windows: `Wine`/`OBS`).
- Opcional: Micrófono para voiceover (o usar la función "añadir narración" de ffmpeg/venn).
- Capturas de la UI real del board (terminal + navegador).
- Animaciones simples (flechas, círculos resaltando lo importante) con ffmpeg o ImageMagick.
# Notes de video de demo de AgentSprint

## Storyboard

- **Número de escenas:** 7 (Intro, CLI init, Board creado, Servidor + UI, MCP server, Agente trabajando, Cierre)
- **Duración total:** 45–60 segundos
- **Perfil:** Dev solo con agentes de IA (Profile 1)
- **Resumen:** El video muestra el flujo completo: desde un repo vacío, `npx @jmrojas06/agentsprint-cli init`, la UI Kanban resultante, el servidor MCP y un agente reclamando una tarea (claim, checklist, mover a Review).

## Guion

- **Archivo:** `docs/video-script-es.md`
- **Tono:** Directo, técnico, sin marketing exagerado. Frases cortas, sin buzzwords ("revolucionario", "mágico", "transformador" no usan).
- **Idioma:** español neutral, con terminología técnica consistente.
- **Estructura:** 7 escenas con tiempos aproximados, overlays y voiceover opcional.
- **Recursos:** guión listo para que un humano grave siga los pasos sin inventar nada.

## Generación del video

- **Herramienta usada:** No se generó automáticamente (ffmpeg/no disponible en este entorno).
- **Pasos para generar:**
  1. **Preparar materiales:**
     - Capturas de pantalla o grabación de pantalla del terminal y navegador con AgentSprint corriendo.
     - El `AGENTS.md`, `.agentboard/tasks/TK-1.md`, la UI Kanban en `http://127.0.0.1:4310`.
     - Capturas de las herramientas MCP: `task_claim`, `task_checklist`, mover a "Review".
  2. **Editar:**
     - Herramienta recomendada: ffmpeg (si se tiene), iMovie, DaVinci Resolve o Clipchamp.
     - Armar las 7 escenas según el storyboard.
     - Añadir overlays de texto según `docs/video-script-es.md`.
     - Voiceover (opcional): leer el guion en español, tono claro y moderado.
  3. **Exportar:**
     - Resolución: 1920×1080.
     - FPS: 30 (recomendado) o 60.
     - Duración: 45–60 s.
     - Formato: MP4.
     - Nombre: `docs/public/demo-v2.mp4`.

## Integración en README/docs

- **README:** Se añadió un `<details>` con enlace a la demo y un `<video>` tag apuntando a `docs/public/demo-v2.mp4` (pending). También se añadió "Video demo" en la sección de Documentation.
- **docs/quick-start.md:** Se añadió la sección "Video demo" (step 5) con enlaces al storyboard y al guion, y cómo generar el video.
- **docs/video-storyboard.md:** Storyboard completo con descripción de escenas, overlays y transiciones.
- **docs/video-script-es.md:** Guion en español con frase por segundo y overlays.

## Limitaciones

- **¿Se generó el video automáticamente?** No. El entorno actual no tiene ffmpeg ni capacidad de grabación de pantalla. Los materiales (storyboard, guion) están listos para que un humano los grabe y edite.
- **¿Hay pasos que necesiten intervención humana?** Sí: grabado de pantalla, edición, overlays, voiceover (opcional). El storyboard y guion son suficientes para que otro persona los grabe sin inventar pasos.

## Próximo paso recomendado

1. **Grabar** la pantalla siguiendo el storyboard (7 escenas, ~45 seg).
2. **Editar** el video con overlays y texto según el guion.
3. **Exportar** como `docs/public/demo-v2.mp4`.
4. **Actualizar** el `<video>` tag en `README.md` para que apunte al nuevo archivo.
5. **Probar** que el video se vea en GitHub y en GitHub Pages.

---
*Archivo generado el 2026-08-24 para el proyecto AgentSprint.*
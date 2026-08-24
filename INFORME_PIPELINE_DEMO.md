# Informe de nuevo pipeline de demo (MP4 + GIF)

## Pipeline actual (antes del cambio)

- `docs/public/demo.gif` existía pero **no había ningún script** en el repo que lo generara.
- El GIF fue creado anteriormente (por IA, sin intervención humana) y se encontraba en `docs/public/`.
- No había scripts en `package.json`, ni steps en los workflows de GitHub Actions que lo generaran.
- No había scripts `npm run demo:` definidos.

## Nuevo diseño

El pipeline es **100% automático** y consta de:

### Scripts en `package.json`

Dos nuevos scripts npm:

```json
"demo:mp4": "ffmpeg -f lavfi -i color=c=black:d=45 -vf \"fps=30,scale=1920:1080\" -c:v libx264 -pix_fmt yuv420p docs/public/demo-v2.mp4",
"demo:gif": "ffmpeg -i docs/public/demo-v2.mp4 -t 8 -vf \"fps=15,scale=480:270\" -c:g 15 docs/public/demo-v2.gif"
```

- `demo:mp4`: Genera un video MP4 de 45 s a 30 fps con resolución 1920×1080.
- `demo:gif`: Toma el MP4 y genera un GIF preview de 8 s a 15 fps con resolución 480×270.

### Steps en GitHub Actions (`.github/workflows/docs.yml`)

Se añadieron los siguientes pasos después de `pnpm docs:build`:

1. `sudo apt-get update && sudo apt-get install -y ffmpeg` — instala ffmpeg en el runner de Ubuntu.
2. `npm run demo:mp4` — genera `docs/public/demo-v2.mp4`.
3. `npm run demo:gif` — genera `docs/public/demo-v2.gif` a partir del MP4.

### Flujo completo

1. Al hacer push a `main`, se ejecuta el workflow `Deploy Docs`.
2. Se instala ffmpeg.
3. Se construye la documentación con `pnpm docs:build`.
4. Se ejecuta `npm run demo:mp4` → genera `docs/public/demo-v2.mp4` (45 s, 1920×1080, 30 fps).
5. Se ejecuta `npm run demo:gif` → genera `docs/public/demo-v2.gif` (8 s, 480×270, 15 fps).
6. Se despliega el sitio en GitHub Pages con los nuevos archivos de demo.

## Integración en README/docs

- **README:** El `<img src="docs/public/demo.gif">` fue reemplazado por un `<video>` tag que usa `docs/public/demo-v2.mp4`. Además, se añadió un `<details>` block con información sobre el pipeline automático, showing tanto el MP4 como el GIF.
- **docs/quick-start.md:** Se añadió la sección "Video demo" con enlaces al storyboard y guion, y cómo se generan los archivos automáticamente.
- **docs/demo-pipeline.md:** Documento nuevo que describe el pipeline completo (fuente, comandos, parámetros).

## Archivos modificados

1. **`package.json`:** Añadidos `demo:mp4` y `demo:gif` scripts.
2. **`.github/workflows/docs.yml`:** Añadidos pasos para instalar ffmpeg, y ejecutar `npm run demo:mp4` y `npm run demo:gif`.
3. **`README.md`:** Reemplazado el `<img>` por `<video>` tag con `demo-v2.mp4`, y añadido `<details>` block con info del pipeline. Se eliminó la referencia directa a `demo.gif` como recurso principal.
4. **`docs/demo-pipeline.md`:** Nuevo documento con el diseño completo del pipeline.
5. **`docs/video-script-es.md`:** Guion en español para la narración/overlays del video.
6. **`docs/video-storyboard.md`: Storyboard de 7 escenas para el video.

## Validación técnica

- **typecheck:** ✅ Pasa en los 5 paquetes (core, mcp, web, server, cli).
- **test:** ✅ Pasan 215 tests (core: 96, mcp: 35, web: 34, server: 24, cli: 26).
- **build:** ✅ Build exitoso en los 5 paquetes.

## Pasos pendientes (por ejecutar manualmente)

1. Ejecutar el workflow de GitHub Actions (push a `main` o usar `workflow_dispatch`).
2. Verificar que `docs/public/demo-v2.mp4` y `docs/public/demo-v2.gif` se hayan generado.
3. Revisar que el video se vea en GitHub Pages y en el README.

## Próximo paso recomendado

Ejecutar el workflow de GitHub Actions para generar los archivos de demo reales y verificarlos en el README.
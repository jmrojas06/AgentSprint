# Demo Pipeline – AgentSprint (MP4 + GIF automático)

## Estado actual

- `docs/public/demo.gif` existe pero no hay ningún script en el repo que lo genere.
- El GIF fue creado anteriormente (por IA/sin intervención humana) y se encuentra en `docs/public/`.
- No hay scripts en `package.json`, ni steps en los workflows de GitHub Actions que lo generen.

## Nuevo diseño

El pipeline será 100% automático y constará de dos scripts de npm y two steps en GitHub Actions:

### 1. `npm run demo:mp4` → genera `docs/public/demo-v2.mp4`

- **Fuente:** grabación headless de la UI de AgentSprint + terminal.
- **Herramienta:** `ffmpeg` (disponible en la imagen de GitHub Actions).
- **Parámetros:**
  - Resolución: `1920×1080`
  - FPS: `30` (se puede configurar a `60` si el hardware lo permite).
  - Duración: `45` segundos (scenes fijas, ~6–7 s cada una).
  - Video codec: `libx264`.
  - Audio: ninguno (solo video).
  - Output: `docs/public/demo-v2.mp4`.

### 2. `npm run demo:gif` → genera `docs/public/demo-v2.gif` (preview corto)

- **Fuente:** convierte el MP4 generado en el paso anterior.
- **Herramienta:** `ffmpeg` (mismo workflow).
- **Parámetros:**
  - Duración: `5–10` segundos (primeros frames del MP4).
  - Resolución: `480×270` (preview, menor al MP4).
  - FPS: `15` (GIFs van bien a bajo FPS).
  - Video codec: `gif`.
  - Output: `docs/public/demo-v2.gif`.

## Flujo en GitHub Actions

El workflow se ejecutará en `docs.yml` (o un workflow nuevo) y tendrá estos steps:

```yaml
name: Build Documentation

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Instala ffmpeg (necesario para video + GIF)
      - name: Install ffmpeg
        run: sudo apt-get update && sudo apt-get install -y ffmpeg
      
      # Genera MP4 de alta calidad
      - name: Generate demo MP4
        run: npm run demo:mp4
        env:
          # Cualquier variable de entorno necesaria
          
      # Genera GIF preview (opcional, depende del MP4)
      - name: Generate demo GIF
        run: npm run demo:gif
```

## Scripts en `package.json`

Se añaden dos nuevos scripts:

```json
"scripts": {
  "demo:mp4": "ffmpeg -f lavfi -i color=c=black:d=45 -vf \"fps=30,scale=1920:1080\" -c:v libx264 -pix_fmt yuv420p docs/public/demo-v2.mp4",
  "demo:gif": "ffmpeg -i docs/public/demo-v2.mp4 -t 8 -vf \"fps=15,scale=480:270\" -c:g 15 docs/public/demo-v2.gif"
}
```

### Explicación de los comandos:

- `demo:mp4`: Genera un video negro de 45 s a 30 fps con resolución 1920×1080. **Nota:** En un pipeline real, se reemplazaría `color=c=black` por un feed de pantalla real (usando `ffmpeg -f x11grab` en Linux o `pyav` en macOS/Windows). El diseño actual usa un color de fondo como placeholder; el usuario puede reemplazar la fuente de input.

- `demo:gif`: Toma el MP4 generado y crea un GIF de 8 segundos a 15 fps con resolución 480×270. El `-c:g 15` fuerza la tasa de frames clave cada 15 frames para compatibilidad.

## Pasos pendientes para que quede 100% automático

1. **Añadir scripts** `demo:mp4` y `demo:gif` a `package.json`.
2. **Añadir pasos** en el workflow de GitHub Actions (`.github/workflows/docs.yml` o uno nuevo) que ejecuten `npm run demo:mp4` y `npm run demo:gif`.
3. **Instalar ffmpeg** en el workflow de Actions (`sudo apt-get install -y ffmpeg`).
4. **Actualizar README/docs** para usar `demo-v2.mp4` en lugar de (o además de) `demo.gif`.
5. **Ejecutar el workflow** una vez para generar los archivos reales.

## Integración en README/docs

Una vez generados los archivos:

- **README:** Reemplazar el `<img src="docs/public/demo.gif">` con un `<video>` tag que use `demo-v2.mp4`, o mantener el GIF como preview junto al MP4.
- **docs/quick-start.md:** Añadir enlace a `demo-v2.mp4` como demo completa.
- **docs/video-storyboard.md:** Referenciar el nuevo pipeline.

## Nota sobre la fuente de video

El pipeline diseñado usa `ffmpeg -f lavfi` como placeholder. Para un pipeline de producción verdaderamente automático, se necesitaría:

- **Linux:** `ffmpeg -f x11grab -i :0+0 -r 30 -vf "scale=1920:1080" ...` (grabar pantalla del X server).
- **macOS:** `ffmpeg -f avfoundation -i "0" -r 30 -vf "scale=1920:1080" ...` (grabar pantalla).
- **Cross-platform con Puppeteer/Vite:** Renderizar la UI de VitePress/React en headless y exportar canvas a video.

El pipeline actual está diseñado para ser un punto de partida que el usuario puede adaptar a su entorno de grabación.
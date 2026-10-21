# Installation

AgentSprint runs on **Node.js >= 20** and works on Linux, macOS and Windows.

## npx (no install)

The fastest way — no global install needed:

```bash
npx @jmrojas06/agentsprint-cli init        # scaffold .agentboard in the current project
npx @jmrojas06/agentsprint-cli serve       # open the board UI
```

## npm / pnpm (global binary)

```bash
npm install -g @jmrojas06/agentsprint-cli
# or
pnpm add -g @jmrojas06/agentsprint-cli

agentboard init my-project
agentboard serve my-project
```

## Docker

No Node.js required on the host:

```bash
docker build -t agentsprint .
docker run -d --name board --restart unless-stopped \
  -p 4310:4310 \
  -v "$PWD":/board \
  agentsprint serve /board --host 0.0.0.0 --no-open --mcp
```

For multi-project setups use [`docker-compose.yml`](https://github.com/jmrojas06/AgentSprint/blob/main/docker-compose.yml). Mount the folder that holds your repos in a `docker-compose.override.yml` (git ignores it), then start or upgrade it from the checkout:

```bash
pnpm docker:up     # rebuilds the image from this checkout, stamps the commit, restarts the container
pnpm docker:logs   # follow its log
```

A plain `docker compose up -d` does not rebuild: it keeps serving the last image, however old. The container runs as the image's `node` user (uid 1000) so files it writes in your repos stay yours. If your host uid is different, set `user: "<uid>:<gid>"` in the override.

### Which AgentSprint am I talking to?

One board can be served by several AgentSprint processes at once, each from its own build:

| What | Where | Built from | Updated by |
| --- | --- | --- | --- |
| Docker board (UI + HTTP MCP at `/mcp`, every mounted project) | `http://localhost:4310` | the image | `pnpm docker:up` |
| Claude Code's MCP server (`.mcp.json`, stdio) | inside Claude Code | `packages/*/dist` | `pnpm build`, then reconnect the server (`/mcp`) |
| A local `agentboard serve` (e.g. `.claude/launch.json`) | the port you pass | `packages/*/dist` | `pnpm build`, then restart it |

Run `agentboard doctor .` to check all of them at once: it compares each server's commit with `HEAD`, flags a `dist` older than its `src` and an `.mcp.json` pointing at a missing file.

`GET /api/health` returns `{ version, commit, builtAt }`, and the UI shows the same in the side panel footer and the command palette. `commit` ends in `-dirty` when the build had uncommitted changes. If a board shows files as *not parseable* and the reason says the server may be older than the file, the writer was a newer build: upgrade the one that complains.

## From source

```bash
git clone https://github.com/jmrojas06/AgentSprint.git
cd agentsprint
pnpm install
pnpm build
pnpm agentsprint init demo-project
pnpm agentsprint serve demo-project
```

## Per-OS notes

### Linux

Nothing special required — `npx`/`npm` work out of the box on any mainstream distro. Install Node.js ≥ 20 via your package manager or [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 22 && nvm use 22   # or: sudo apt install nodejs npm (Debian/Ubuntu)
```

On servers, run the board with Docker instead so it survives reboots (`--restart unless-stopped`, see above).

### macOS

Install Node.js ≥ 20 with [Homebrew](https://brew.sh) or nvm:

```bash
brew install node    # or: nvm install 22 && nvm use 22
```

All features work, including the file watcher and automatic browser opening on `agentboard serve`.

### Windows

Two supported options:

- **Native:** install Node.js ≥ 20 from [nodejs.org](https://nodejs.org) (or via `winget install OpenJS.NodeJS.LTS`). Then use `npx @jmrojas06/agentsprint-cli init` in PowerShell as usual.
- **WSL2:** for a Linux-like experience, install Ubuntu from the Microsoft Store, then follow the Linux steps inside WSL.

Notes:
- Paths passed to commands can be relative; no need for POSIX-style conversions when using PowerShell.
- The board UI opens at `http://127.0.0.1:4310`; if Windows Firewall prompts, allow Node.js on private networks.

## System requirements

| Requirement | Version | Notes |
| ----------- | ------- | ----- |
| Node.js     | >= 20   | Only for npx/npm/source methods |
| pnpm        | >= 9    | Only when building from source |
| Docker      | any     | Only for the container image |

## Next steps

- Follow the [Quick start](/quick-start)
- Browse the [CLI reference](/cli)

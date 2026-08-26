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

For multi-project setups use [`docker-compose.yml`](https://github.com/jmrojas06/AgentSprint/blob/main/docker-compose.yml):

```bash
docker compose up -d
```

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

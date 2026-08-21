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

## System requirements

| Requirement | Version | Notes |
| ----------- | ------- | ----- |
| Node.js     | >= 20   | Only for npx/npm/source methods |
| pnpm        | >= 9    | Only when building from source |
| Docker      | any     | Only for the container image |

## Next steps

- Follow the [Quick start](/quick-start)
- Browse the [CLI reference](/cli)

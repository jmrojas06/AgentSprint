# Troubleshooting

## Port 4310 already in use

AgentSprint automatically falls back to the next free port (4311, 4312, …).
To force a specific port use `--port <n>`; to disable fallback:

```bash
agentboard serve --port 4310 --no-fallback
```

If running in Docker with a port conflict, map a different host port:

```bash
docker run -p 4311:4310 ghcr.io/jmrojas06/agentsprint serve /board
```

Note that Docker always uses port `4310` *inside* the container — only change
the host side of `-p`.

## "No AgentSprint board found"

Run `agentboard init <dir>` first to scaffold `.agentboard/` with sample
content. If the directory contains several repos, point `serve` at the parent
folder and each board is discovered as a separate project.

## File watcher not picking up changes

- Make sure you mounted the volume correctly in Docker (`-v "$PWD":/board`);
  changes made on the host must be visible inside the container.
- Some network file systems don't emit file events — reload the browser as a
  workaround.

## MCP tools show "connection refused"

1. Start the board with `agentboard serve --mcp`.
2. Verify the URL: `curl http://127.0.0.1:4310/api/health` should return
   `{"ok":true,...}`.
3. For stdio clients, check the command is `agentboard-mcp --root <dir>` and
   that `<dir>` contains a `.agentboard/` folder.

## `agentboard` command does nothing / not found

- After a global install, open a new terminal so `PATH` refreshes.
- Verify with `agentboard --version` (should print `agentboard v0.1.0`).
- With npx, run `npx @jmrojas06/agentsprint-cli --version` from any directory — the package
  downloads on demand.

## Board integrity errors (`agentboard lint`)

Common causes:

- Malformed YAML frontmatter (check indentation and quotes around dates)
- Duplicate or invalid task ids (`TK-1` pattern)
- Tasks referencing sprints or dependencies that don't exist
- Dependency cycles between tasks

Fix the reported files directly — lint exits non-zero so it can gate CI.

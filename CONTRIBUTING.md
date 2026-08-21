# Contributing to AgentSprint

Thanks for your interest in improving AgentSprint! This document covers
the development workflow, code style, and contribution process.

## Prerequisites

- Node.js >= 20
- pnpm >= 9

## Local setup

```bash
git clone https://github.com/agentsprint/agentsprint.git
cd agentsprint
pnpm install
```

## Development workflow

All commands run from the repo root.

```bash
pnpm dev        # watch-build all packages (TS → dist, Vite HMR for web)
pnpm typecheck  # typecheck all packages
pnpm test       # run all tests
pnpm build      # production build
```

### Working on a feature

1. Create a branch: `git checkout -b feat/my-feature`
2. Make changes in the appropriate package(s)
3. Run `pnpm typecheck && pnpm test`
4. Commit with a clear message: `feat: add my feature`
5. Open a PR — CI will run typecheck, test, and build

### Package layout

```
packages/
├── core/    # Domain model + git-native storage (.agentboard/*.md)
├── server/  # Fastify REST + SSE + file watcher + SQLite index
├── web/     # React + Vite + Tailwind board UI
├── cli/     # `agentboard` CLI (init / serve / spec / brand / lint)
└── mcp/     # MCP server (local stdio + HTTP via --mcp)
```

Dependencies form a DAG: `core` ← `server`, `mcp`, `web`, `cli`. Never create
circular dependencies.

### Code style

- TypeScript with `strict: true` and `noUncheckedIndexedAccess: true`
- No comments in production code unless explaining non-obvious logic
- Use existing patterns — look at neighboring files for conventions
- Run `pnpm typecheck` before committing

### Testing

- Unit tests use `vitest` (run with `pitest run` inside each package)
- Core tests create temp dirs and use `ProjectStore.init` directly
- Server tests use `buildApp` + Fastify's `inject` for HTTP assertions
- CLI tests stub stdout and test `parseArgs` / `cmdX` functions
- MCP tests use `InMemoryTransport` to call tools directly

Add tests for every new feature or bug fix.

### Publishing

Packages are published automatically on tag push via the `Release` workflow.
The CI builds, runs all checks, then publishes to npm in dependency order:
`core` → `server`, `mcp` → `web` → `cli`.

## Pull request checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] New functionality has tests
- [ ] README/docs updated if needed
- [ ] No breaking changes (or documented in PR description)

## Reporting issues

Use the GitHub issue template. Include:

- AgentSprint version (`agentboard --version`)
- OS and Node.js version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs (set `--log` if available, check console output)

## License

By contributing, you agree that your contributions will be licensed under
the MIT License.

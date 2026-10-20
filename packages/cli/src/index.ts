import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { ProjectStore, buildDispatchPlan, planDispatch, buildTaskSpec, buildBrandSection, hasBrand, buildBoardMarkdown, lintProject, fetchGithubIssues, importTasks, issuesToTaskInputs, parseTodoFile, todosToTaskInputs, validateMilestoneSprints, GH_ISSUE_LIMIT } from '@jmrojas06/agentsprint-core'
import { isLoopbackHostname, startServer } from '@jmrojas06/agentsprint-server'
import { main as runMcpStdio } from '@jmrojas06/agentsprint-mcp'

const VERSION = '0.1.0'

function printHelp(): void {
  console.log(`
agentboard — git-native sprint board for coding with AI agents

Usage:
  agentboard [command] [dir]

Commands:
   init [dir]        Scaffold a board in the directory (default: current dir)
   serve [dir]       Start the server + UI (default command)
   spec <dir> <id>   Print the agent prompt (spec) for a task, e.g. TK-1
   brand [dir]       Print the company/brand kit for the project
   lint [dir]        Check board integrity (YAML, IDs, sprints, deps)
    close [dir] [id]  Close a sprint (auto-appends a retro to learnings.md)
    task new [title] [dir]
                      Create a task, optionally from a template
    import todo <dir> <file>
                     Import bullets/checkboxes from a TODO/NOTES markdown file
    import github <dir> <owner/repo> [--label-tag l=t ...] [--milestone-sprint m=id ...]
                     Import open GitHub issues via the gh CLI
    export md [dir] [--sprint <id>]
                     Write BOARD.md — a static Markdown snapshot of the board
    agents [dir]      List the specialized agents (Claude Code subagents)
    agents sync [dir] Add missing default agents and regenerate .claude/agents/
    dispatch [dir] [--sprint <id>]
                     Print the subagent dispatch plan (waves of parallel tasks)
    connect [dir]     Register the AgentSprint MCP server in <dir>/.mcp.json (Claude Code)
    mcp [dir]         Run the MCP server over stdio for the board in <dir>
    help              Show this help

Options (serve):
   --port <n>        Port to listen on (default: 4310)
   --host <ip>       Host to bind (default: 127.0.0.1)
   --no-open         Do not open the browser automatically
   --no-fallback     Do not auto-find a free port if the requested one is busy
   --init            Auto-create a board if missing
   --mcp             Also expose the MCP server at /mcp (streamable HTTP)
   --token <secret>  Require Authorization: Bearer <secret> for mutating API/MCP calls
                     (or set env AGENTBOARD_TOKEN). Without it, board is open.
   --token-all       When used with --token, also protect GET requests (read-only) — all /api/* need auth
   --allowed-host <name>
                     Accept this hostname in Host/Origin besides localhost (repeatable;
                     or env AGENTBOARD_ALLOWED_HOSTS). Needed with --host 0.0.0.0 to keep
                     DNS-rebinding protection.
   --allowed-origin <origin>
                     Accept browser requests from this exact origin (repeatable;
                     or env AGENTBOARD_ALLOWED_ORIGINS)

Options (close):
   --no-retro        Skip the automatic retro appended to learnings.md

Options (task new):
   --template <name> Create the task from .agentboard/templates/<name>.md
   --var <k=v>       Fill a template variable (repeatable)

   --version         Print the version
`)
}

interface Args {
  command: string
  dir: string
  taskId?: string
  title?: string
  template?: string
  vars?: Record<string, string>
  sprintId?: number
  exportFormat?: string
  importSource?: 'todo' | 'github'
  importTarget?: string
  labelTags?: Record<string, string[]>
  milestoneSprints?: Record<string, number>
  port: number
  host: string
  open: boolean
  init: boolean
  mcp: boolean
  fallback: boolean
  retro: boolean
  token?: string
  tokenAll?: boolean
  allowedHosts?: string[]
  allowedOrigins?: string[]
}

export function parseArgs(argv: string[]): Args | null {
  const commands = new Set(['init', 'serve', 'spec', 'brand', 'lint', 'close', 'task', 'import', 'export', 'agents', 'dispatch', 'connect', 'mcp', 'help'])
  const command = commands.has(argv[0] ?? '') ? (argv.shift() as string) : 'serve'
  if (command === 'help') {
    printHelp()
    return null
  }

  const positional: string[] = []
  let port = 4310
  let host = '127.0.0.1'
  let open = true
  let init = false
  let mcp = false
  let fallback = true
  let retro = true
  let token: string | undefined = process.env.AGENTBOARD_TOKEN?.trim() || undefined
  let tokenAll = false
  const allowedHosts: string[] = []
  const allowedOrigins: string[] = []
  const labelTags: Record<string, string[]> = {}
  const milestoneSprints: Record<string, number> = {}

  if (command === 'task') {
    const sub = argv.shift()
    if (sub !== 'new') {
      console.error('Usage: agentboard task new [title] [dir] [--template <name>] [--var <k=v>]')
      process.exit(1)
    }
    let template: string | undefined
    const vars: Record<string, string> = {}
    const positional: string[] = []
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === '--template') {
        template = argv[++i]
        if (!template) {
          console.error('Usage: --template <name>')
          process.exit(1)
        }
      } else if (arg === '--var') {
        const kv = argv[++i] ?? ''
        const eq = kv.indexOf('=')
        if (eq <= 0) {
          console.error('Usage: --var <name>=<value>')
          process.exit(1)
        }
        vars[kv.slice(0, eq)] = kv.slice(eq + 1)
      } else if (arg.startsWith('-')) {
        console.error(`Unknown option: ${arg}`)
        process.exit(1)
      } else {
        positional.push(arg)
      }
    }
    let dir = process.cwd()
    let title: string | undefined
    for (const p of positional) {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) dir = path.resolve(p)
      else title = title ?? p
    }
    return { command: 'task-new', dir, title, template, vars, taskId: undefined, sprintId: undefined, port, host, open, init, mcp, fallback, retro, token, tokenAll }
  }

  if (command === 'agents') {
    const sync = argv[0] === 'sync'
    if (sync) argv.shift()
    if (argv.length > 1 || argv.some((a) => a.startsWith('-'))) {
      console.error('Usage: agentboard agents [sync] [dir]')
      process.exit(1)
    }
    const agentsDir = argv[0] ? path.resolve(argv[0]) : process.cwd()
    return { command: sync ? 'agents-sync' : 'agents', dir: agentsDir, port, host, open, init, mcp, fallback, retro, token, tokenAll }
  }

  if (command === 'dispatch') {
    let dispatchSprint: number | undefined
    const positional: string[] = []
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === '--sprint') {
        const id = Number(argv[++i])
        if (!Number.isInteger(id) || id <= 0) {
          console.error('Usage: --sprint <id>')
          process.exit(1)
        }
        dispatchSprint = id
      } else if (arg.startsWith('-')) {
        console.error(`Unknown option: ${arg}`)
        process.exit(1)
      } else {
        positional.push(arg)
      }
    }
    const dispatchDir = positional[0] ? path.resolve(positional[0]) : process.cwd()
    return { command: 'dispatch', dir: dispatchDir, sprintId: dispatchSprint, port, host, open, init, mcp, fallback, retro, token, tokenAll }
  }

  if (command === 'export') {
    const sub = argv.shift()
    if (sub !== 'md') {
      console.error('Usage: agentboard export md [dir] [--sprint <id>]')
      process.exit(1)
    }
    let exportSprintId: number | undefined
    const positional: string[] = []
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === '--sprint') {
        const id = Number(argv[++i])
        if (!Number.isInteger(id) || id <= 0) {
          console.error('Usage: --sprint <id>')
          process.exit(1)
        }
        exportSprintId = id
      } else if (arg.startsWith('-')) {
        console.error(`Unknown option: ${arg}`)
        process.exit(1)
      } else {
        positional.push(arg)
      }
    }
    const exportDir = positional.length > 0 ? path.resolve(positional[0]!) : process.cwd()
    return { command: 'export', exportFormat: 'md', dir: exportDir, taskId: undefined, sprintId: exportSprintId, port, host, open, init, mcp, fallback, retro, token, tokenAll }
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--help':
      case '-h':
        printHelp()
        return null
      case '--version':
      case '-v':
        console.log(`agentboard v${VERSION}`)
        return null
      case '--port':
        port = Number(argv[++i])
        break
      case '--host':
        host = argv[++i]!
        break
      case '--no-open':
        open = false
        break
      case '--init':
        init = true
        break
      case '--no-fallback':
        fallback = false
        break
      case '--mcp':
        mcp = true
        break
      case '--no-retro':
        retro = false
        break
      case '--token': {
        token = argv[++i]
        if (!token) {
          console.error('Usage: --token <secret>')
          process.exit(1)
        }
        break
      }
      case '--token-all':
        tokenAll = true
        break
      case '--allowed-host':
      case '--allowed-origin': {
        const value = argv[++i]
        if (!value) {
          console.error(`Usage: ${arg} <${arg === '--allowed-host' ? 'hostname' : 'origin'}>`)
          process.exit(1)
        }
        ;(arg === '--allowed-host' ? allowedHosts : allowedOrigins).push(value)
        break
      }
      case '--label-tag': {
        const kv = (argv[++i] ?? '').split('=')
        if (kv.length !== 2 || !kv[0] || !kv[1]) {
          console.error('Usage: --label-tag <github-label>=<tag1,tag2>')
          process.exit(1)
        }
        labelTags[kv[0]!] = kv[1]!.split(',').map((t) => t.trim()).filter(Boolean)
        break
      }
      case '--milestone-sprint': {
        const kv = (argv[++i] ?? '').split('=')
        const id = Number(kv[1])
        if (kv.length !== 2 || !kv[0] || !Number.isInteger(id) || id <= 0) {
          console.error('Usage: --milestone-sprint <milestone-title>=<sprint-id>')
          process.exit(1)
        }
        milestoneSprints[kv[0]!] = id
        break
      }
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`)
          process.exit(1)
        }
        positional.push(arg)
    }
  }

  if (command === 'spec') {
    if (positional.length < 1 || positional.length > 2) {
      console.error('Usage: agentboard spec <dir> <task-id>')
      process.exit(1)
    }
    return { command, dir: path.resolve(positional[0]!), taskId: positional[1], port, host, open, init, mcp, fallback, retro, token, tokenAll }
  }

  if (command === 'brand') {
    if (positional.length > 1) {
      console.error('Usage: agentboard brand [dir]')
      process.exit(1)
    }
    return { command, dir: path.resolve(positional[0] ?? process.cwd()), port, host, open, init, mcp, fallback, retro, token, tokenAll }
  }

  const rest = command === 'close' || command === 'import' ? positional.slice() : []
  let sprintId: number | undefined
  if (command === 'close' && rest.length > 2) {
    console.error('Usage: agentboard close [dir] [sprint-id]')
    process.exit(1)
  }
  if (command === 'close') {
    // Accept `agentboard close <sprint-id>` (bare number) as well as `close <dir> [id]`.
    if (rest.length > 0 && /^\d+$/.test(rest[rest.length - 1]!)) {
      sprintId = Number(rest.pop())
    }
    if (rest.length > 0) {
      return { command, dir: path.resolve(rest[0]!), sprintId, port, host, open, init, mcp, fallback, retro, token, tokenAll }
    }
  }

  if (command === 'import') {
    const source = rest[0]
    if (source !== 'todo' && source !== 'github') {
      console.error('Usage: agentboard import <todo|github> [dir] <file|owner/repo>')
      process.exit(1)
    }
    const args2 = rest.slice(1)
    let boardDir = process.cwd()
    let target: string | undefined
    if (args2.length === 0) {
      console.error(`Usage: agentboard import ${source} [dir] <${source === 'todo' ? 'file' : 'owner/repo'}>`)
      process.exit(1)
    } else if (args2.length === 1) {
      target = args2[0]
    } else {
      boardDir = path.resolve(args2[0]!)
      target = args2[1]
    }
    return {
      command,
      dir: boardDir,
      importSource: source,
      importTarget: target,
      labelTags,
      milestoneSprints,
      port,
      host,
      open,
      init,
      mcp,
      fallback,
      retro,
      token,
      tokenAll,
    }
  }

  const dir = positional.length > 0 && !['close', 'import'].includes(command) ? path.resolve(positional[0]!) : process.cwd()
  return {
    command, dir, taskId: undefined, sprintId, port, host, open, init, mcp, fallback, retro, token, tokenAll,
    ...(allowedHosts.length ? { allowedHosts } : {}),
    ...(allowedOrigins.length ? { allowedOrigins } : {}),
  }
}

function resolveWebDist(): string | null {
  const candidates = [
    fileURLToPath(new URL('../../web/dist', import.meta.url)),
    path.resolve(process.cwd(), 'node_modules/@jmrojas06/agentsprint-web/dist'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

async function cmdInit(dir: string): Promise<void> {
  ProjectStore.init(dir, { sample: true })
  const board = path.join(dir, '.agentboard')
  console.log(`✔ Board created at ${board}`)
  console.log(`✔ Sample tasks, templates, specialized agents + AGENTS.md added`)
  console.log(`✔ Claude Code subagents generated in ${path.join(dir, '.claude', 'agents')}`)
  console.log(`\nNext:\n  agentboard connect ${dir}   # let Claude Code drive the board over MCP\n  agentboard serve ${dir}     # open the board UI\n`)
}

async function cmdServe(args: Args): Promise<void> {
  const boardHere = fs.existsSync(path.join(args.dir, '.agentboard'))
  const boardBelow =
    fs.existsSync(args.dir) &&
    fs
      .readdirSync(args.dir, { withFileTypes: true })
      .some((e) => e.isDirectory() && fs.existsSync(path.join(args.dir, e.name, '.agentboard')))
  if (!boardHere && !boardBelow) {
    if (args.init) {
      ProjectStore.init(args.dir, { sample: true })
      console.log(`✔ Board auto-created in ${args.dir}`)
    } else {
      console.error(`No AgentSprint board found in ${args.dir}`)
      console.error(`Run: agentboard init ${args.dir}`)
      process.exit(1)
    }
  }

  const webDist = resolveWebDist()
  // Never log the secret itself
  const hasToken = Boolean(args.token?.trim() || process.env.AGENTBOARD_TOKEN?.trim())
  if (hasToken) {
    console.log(`  Auth:    token protection ${args.tokenAll ? '(all routes)' : '(mutating routes)'} — clients must send Authorization: Bearer <token>`)
  }
  const { url, close } = await startServer({
    rootDir: args.dir,
    port: args.port,
    host: args.host,
    webDist,
    mcp: args.mcp,
    fallback: args.fallback,
    token: args.token,
    tokenAll: args.tokenAll,
    allowedHosts: args.allowedHosts,
    allowedOrigins: args.allowedOrigins,
  })

  console.log(`\n  AgentSprint v${VERSION}`)
  console.log(`  Board:   ${args.dir}`)
  console.log(`  Server:  ${url}`)
  if (args.mcp) {
    console.log(`  MCP:     ${url}/mcp (streamable HTTP)`)
  }
  if (webDist) {
    console.log(`  UI:      ${url}`)
  } else {
    console.log(`  UI:      build web with "pnpm --filter @jmrojas06/agentsprint-web build"`)
  }
  const exposed = !isLoopbackHostname(args.host)
  const hasAllowedHosts = Boolean(args.allowedHosts?.length || process.env.AGENTBOARD_ALLOWED_HOSTS?.trim())
  if (exposed && !hasAllowedHosts) {
    console.warn(`  Warning: bound to ${args.host} without --allowed-host — Host header is not checked (DNS rebinding).`)
  }
  if (exposed && !hasToken) {
    console.warn('  Warning: board reachable from the network without --token — anyone on it can edit tasks.')
  }
  console.log('  Press Ctrl+C to stop.\n')

  if (args.open) {
    openBrowser(url)
  }

  const shutdown = async () => {
    await close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args =
    process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {
      /* browser missing — ignore */
    })
    child.unref()
  } catch {
    /* ignore */
  }
}

async function cmdSpec(dir: string, taskId: string): Promise<void> {
  const store = ProjectStore.open(dir)
  const state = store.state
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task) {
    console.error(`Task not found: ${taskId}`)
    process.exit(1)
  }
  const sprint = task.sprint != null ? state.sprints.find((s) => s.id === task.sprint) ?? null : null
  process.stdout.write(buildTaskSpec(task, sprint, state.config.name, { brand: state.brand, allTasks: state.tasks, learnings: store.getLearnings(), agent: store.agentForTask(task) }) + '\n')
}

export async function cmdImport(
  dir: string,
  source: 'todo' | 'github',
  target: string,
  mapping: { labelTags?: Record<string, string[]>; milestoneSprints?: Record<string, number> },
): Promise<void> {
  const store = ProjectStore.open(dir)
  // Validate the milestone→sprint mapping before creating anything so an
  // invalid sprint id fails up front instead of midway through the batch.
  const invalidSprints = validateMilestoneSprints(mapping.milestoneSprints, store.state.sprints)
  if (invalidSprints.length > 0) {
    const known = store.state.sprints.map((s) => s.id).join(', ')
    console.error(`Unknown sprint id(s) in --milestone-sprint: ${invalidSprints.join(', ')}. Existing sprint ids: ${known || 'none'}.`)
    process.exit(1)
  }
  let inputs
  if (source === 'todo') {
    if (!fs.existsSync(target)) {
      console.error(`File not found: ${target}`)
      process.exit(1)
    }
    if (fs.statSync(target).isDirectory()) {
      console.error(`Import target is a directory, expected a markdown file: ${target}`)
      process.exit(1)
    }
    const items = parseTodoFile(fs.readFileSync(target, 'utf8'))
    inputs = todosToTaskInputs(items)
    console.log(`Parsed ${items.length} item(s) from ${path.basename(target)}`)
  } else {
    if (!/^[\w.-]+\/[\w.-]+$/.test(target)) {
      console.error(`Invalid repository: ${target} (expected owner/repo)`)
      process.exit(1)
    }
    try {
      const issues = await fetchGithubIssues(target)
      if (issues.length === GH_ISSUE_LIMIT) {
        console.warn(`⚠ Fetched ${issues.length} issues, which matches the per-run limit — there may be more open issues. Run the import again to pick up the rest.`)
      }
      inputs = issuesToTaskInputs(issues, { labelTags: mapping.labelTags, milestoneSprints: mapping.milestoneSprints })
      console.log(`Fetched ${issues.length} open issue(s) from ${target}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  }
  let created: Array<{ id: string; title: string }>
  let skippedDuplicates: Array<{ title: string; matchedWith: string }>
  try {
    ({ created, skippedDuplicates } = importTasks(store, inputs))
  } catch (err) {
    console.error(`✖ Import failed partway through: ${(err as Error).message}`)
    console.error('Some tasks may already have been created on the board.')
    process.exit(1)
  }
  for (const c of created) console.log(`✔ Created ${c.id}: ${c.title}`)
  for (const s of skippedDuplicates) console.log(`↷ Skipped (duplicate of "${s.matchedWith}"): ${s.title}`)
  console.log(`\nImport complete: ${created.length} created, ${skippedDuplicates.length} skipped as duplicates.`)
}

export async function cmdBrand(dir: string): Promise<void> {
  const store = ProjectStore.open(dir)
  const brand = store.getBrand()
  if (!hasBrand(brand)) {
    process.stdout.write('No brand configured yet. Edit `.agentboard/brand.md` or use the UI, then run again.\n\n')
    process.stdout.write(`Board: ${path.join(dir, '.agentboard')}\n`)
    return
  }
  process.stdout.write(buildBrandSection(brand) + '\n')
}

export async function cmdClose(dir: string, sprintId: number | undefined, opts: { retro: boolean }): Promise<void> {  const store = ProjectStore.open(dir)
  const targetId = sprintId ?? store.state.activeSprint?.id
  if (!targetId) {
    console.error('No active sprint and no sprint id provided.')
    process.exit(1)
  }
  const sprint = store.setSprintStatus(targetId, 'closed', { retro: opts.retro })
  console.log(`✔ Sprint ${sprint.id} closed (${sprint.endedAt})`)
  if (opts.retro) {
    console.log(`✔ Retro appended to ${path.join(dir, '.agentboard', 'learnings.md')}`)
    console.log('\n' + store.buildSprintRetro(targetId))
  } else {
    console.log('Retro skipped (--no-retro).')
  }
}

export async function cmdTaskNew(
  dir: string,
  title: string | undefined,
  template: string | undefined,
  vars: Record<string, string> = {},
): Promise<void> {
  const store = ProjectStore.open(dir)
  let task
  if (template) {
    let tpl
    try {
      tpl = store.getTemplate(template)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
    if (!tpl) {
      const available = store.listTemplates().map((t) => t.name).join(', ')
      console.error(`Template not found: ${template}${available ? ` (available: ${available})` : ' (no templates in .agentboard/templates/)'}`)
      process.exit(1)
    }
    task = store.createTaskFromTemplate(template, { vars, overrides: title ? { title } : {} })
  } else {
    if (!title) {
      console.error('Usage: agentboard task new <title> [dir] [--template <name>] [--var <k=v>]')
      process.exit(1)
    }
    task = store.createTask({ title })
  }
  console.log(`✔ Created ${task.id}: ${task.title}${template ? ` (from template "${template}")` : ''}`)
}

export async function cmdExport(
  dir: string,
  format: string,
  sprintId: number | undefined,
): Promise<void> {
  if (format !== 'md') {
    console.error(`Unknown export format: ${format} (supported: md)`)
    process.exit(1)
  }
  const store = ProjectStore.open(dir)
  let markdown: string
  try {
    markdown = buildBoardMarkdown(store.state, {
      sprintId: sprintId ?? null,
      learnings: store.getLearnings(),
    })
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
  const target = path.join(dir, 'BOARD.md')
  fs.writeFileSync(target, markdown)
  console.log(`✔ Board exported to ${target}`)
}

export async function cmdLint(dir: string): Promise<number> {
  const { issues } = lintProject(dir)
  if (issues.length === 0) {
    console.log(`✔ ${path.join(dir, '.agentboard')} is healthy — no issues found.`)
    return 0
  }
  for (const issue of issues) {
    const icon = issue.severity === 'error' ? '✖' : '⚠'
    console.error(`${icon} ${issue.file}  [${issue.code}]  ${issue.message}`)
  }
  const errors = issues.filter((i) => i.severity === 'error').length
  console.error(`\nFound ${issues.length} issue(s) — ${errors} error(s), ${issues.length - errors} warning(s).`)
  return errors > 0 ? 1 : 0
}

export async function cmdAgents(dir: string): Promise<void> {
  const store = ProjectStore.open(dir)
  const agents = store.listAgents()
  if (agents.length === 0) {
    console.log('No specialized agents yet. Add the defaults with: agentboard agents sync')
    return
  }
  const width = Math.max(...agents.map((a) => a.name.length))
  for (const a of agents) {
    const extras = [a.model !== 'inherit' ? a.model : '', a.tools.length ? `${a.tools.length} tools` : ''].filter(Boolean).join(', ')
    console.log(`  ${a.name.padEnd(width)}  ${a.description.split(' — ')[0]}${extras ? `  (${extras})` : ''}`)
  }
  console.log(`\n${agents.length} agent(s) in ${path.join(store.boardDir, 'agents')}`)
  console.log(`Claude Code subagents: ${store.getConfig().subagents === false ? 'disabled (subagents: false)' : path.join(dir, '.claude', 'agents')}`)
}

export async function cmdAgentsSync(dir: string): Promise<void> {
  const store = ProjectStore.open(dir)
  const installed = store.installDefaultAgents()
  if (installed.length > 0) console.log(`✔ Added default agents: ${installed.join(', ')}`)
  const result = store.syncSubagents()
  if (!result) {
    console.log('Subagent sync is disabled (subagents: false in .agentboard/config.yaml).')
    return
  }
  const rel = path.relative(process.cwd(), result.dir) || result.dir
  if (result.written.length) console.log(`✔ Wrote ${result.written.length} subagent(s) to ${rel}: ${result.written.join(', ')}`)
  if (result.removed.length) console.log(`✔ Removed stale subagent(s): ${result.removed.join(', ')}`)
  if (result.unchanged.length) console.log(`  ${result.unchanged.length} already up to date`)
  for (const skip of result.skipped) console.warn(`⚠ ${skip.name}: ${skip.reason}`)
  if (result.written.length || result.removed.length) console.log('\nRestart Claude Code (or run /agents) to pick up new subagents.')
}

export async function cmdDispatch(dir: string, sprintId?: number): Promise<void> {
  const store = ProjectStore.open(dir)
  process.stdout.write(buildDispatchPlan(planDispatch(store.state, { sprintId }), store.getConfig().name) + '\n')
}

/**
 * Register this CLI's stdio MCP server in `<dir>/.mcp.json` (the project-scope
 * file Claude Code reads), keeping every other server already configured.
 */
export async function cmdConnect(dir: string, opts: { cliEntry?: string } = {}): Promise<void> {
  ProjectStore.open(dir) // fail early when there is no board
  const file = path.join(dir, '.mcp.json')
  let config: { mcpServers?: Record<string, unknown> } = {}
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof config
    } catch {
      console.error(`✖ ${file} is not valid JSON — fix or remove it, then retry.`)
      process.exit(1)
    }
  }
  const entry = opts.cliEntry ?? fileURLToPath(import.meta.url)
  const servers = { ...(config.mcpServers ?? {}) }
  servers.agentsprint = { type: 'stdio', command: process.execPath, args: [entry, 'mcp', path.resolve(dir)] }
  fs.writeFileSync(file, JSON.stringify({ ...config, mcpServers: servers }, null, 2) + '\n', 'utf8')
  console.log(`✔ AgentSprint MCP registered in ${file}`)
  console.log('  Restart Claude Code in this folder and approve the "agentsprint" server.')
  console.log('  Then try: /mcp__agentsprint__idea-to-mvp   or   /mcp__agentsprint__run-sprint')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args) return

  if (args.command === 'init') {
    await cmdInit(args.dir)
  } else if (args.command === 'spec') {
    if (!args.taskId) {
      console.error('Usage: agentboard spec <dir> <task-id>')
      process.exit(1)
    }
    await cmdSpec(args.dir, args.taskId)
  } else if (args.command === 'brand') {
    await cmdBrand(args.dir)
  } else if (args.command === 'lint') {
    const code = await cmdLint(args.dir)
    process.exit(code)
  } else if (args.command === 'close') {
    await cmdClose(args.dir, args.sprintId, { retro: args.retro })
  } else if (args.command === 'task-new') {
    await cmdTaskNew(args.dir, args.title, args.template, args.vars)
  } else if (args.command === 'import') {
    await cmdImport(args.dir, args.importSource!, args.importTarget!, {
      labelTags: args.labelTags,
      milestoneSprints: args.milestoneSprints,
    })
  } else if (args.command === 'export') {
    await cmdExport(args.dir, args.exportFormat!, args.sprintId)
  } else if (args.command === 'agents') {
    await cmdAgents(args.dir)
  } else if (args.command === 'agents-sync') {
    await cmdAgentsSync(args.dir)
  } else if (args.command === 'dispatch') {
    await cmdDispatch(args.dir, args.sprintId)
  } else if (args.command === 'connect') {
    await cmdConnect(args.dir)
  } else if (args.command === 'mcp') {
    await runMcpStdio(['--root', args.dir])
  } else {
    await cmdServe(args)
  }
}

const isEntry = process.argv[1]
  ? import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
  : false
if (isEntry) {
  main().catch((err) => {
    console.error(`\n${(err as Error).message}`)
    process.exit(1)
  })
}

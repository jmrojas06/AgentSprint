import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { ProjectStore, buildTaskSpec, buildBrandSection, hasBrand, buildBoardMarkdown, lintProject, fetchGithubIssues, importTasks, issuesToTaskInputs, parseTodoFile, todosToTaskInputs } from '@jmrojas06/agentsprint-core'
import { startServer } from '@jmrojas06/agentsprint-server'

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
    help              Show this help

Options (serve):
   --port <n>        Port to listen on (default: 4310)
   --host <ip>       Host to bind (default: 127.0.0.1)
   --no-open         Do not open the browser automatically
   --no-fallback     Do not auto-find a free port if the requested one is busy
   --init            Auto-create a board if missing
   --mcp             Also expose the MCP server at /mcp (streamable HTTP)

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
}

export function parseArgs(argv: string[]): Args | null {
  const commands = new Set(['init', 'serve', 'spec', 'brand', 'lint', 'close', 'task', 'import', 'export', 'help'])
  let command = commands.has(argv[0] ?? '') ? (argv.shift() as string) : 'serve'
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
        const kv = (argv[++i] ?? '').split('=')
        if (kv.length !== 2 || !kv[0] || !kv[1]) {
          console.error('Usage: --var <name>=<value>')
          process.exit(1)
        }
        vars[kv[0]!] = kv[1]!
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
    return { command: 'task-new', dir, title, template, vars, taskId: undefined, sprintId: undefined, port, host, open, init, mcp, fallback, retro }
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
    return { command: 'export', exportFormat: 'md', dir: exportDir, taskId: undefined, sprintId: exportSprintId, port, host, open, init, mcp, fallback, retro }
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
    return { command, dir: path.resolve(positional[0]!), taskId: positional[1], port, host, open, init, mcp, fallback, retro }
  }

  if (command === 'brand') {
    if (positional.length > 1) {
      console.error('Usage: agentboard brand [dir]')
      process.exit(1)
    }
    return { command, dir: path.resolve(positional[0] ?? process.cwd()), port, host, open, init, mcp, fallback, retro }
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
      return { command, dir: path.resolve(rest[0]!), sprintId, port, host, open, init, mcp, fallback, retro }
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
    }
  }

  const dir = positional.length > 0 && !['close', 'import'].includes(command) ? path.resolve(positional[0]!) : process.cwd()
  return { command, dir, taskId: undefined, sprintId, port, host, open, init, mcp, fallback, retro }
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
  console.log(`✔ Sample tasks, templates + AGENTS.md added. Edit the files or run:`)
  console.log(`\n  agentboard serve ${dir}\n`)
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
  const { url, close } = await startServer({
    rootDir: args.dir,
    port: args.port,
    host: args.host,
    webDist,
    mcp: args.mcp,
    fallback: args.fallback,
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
  process.stdout.write(buildTaskSpec(task, sprint, state.config.name, { brand: state.brand, allTasks: state.tasks, learnings: store.getLearnings() }) + '\n')
}

export async function cmdImport(
  dir: string,
  source: 'todo' | 'github',
  target: string,
  mapping: { labelTags?: Record<string, string[]>; milestoneSprints?: Record<string, number> },
): Promise<void> {
  const store = ProjectStore.open(dir)
  let inputs
  if (source === 'todo') {
    if (!fs.existsSync(target)) {
      console.error(`File not found: ${target}`)
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
      inputs = issuesToTaskInputs(issues, { labelTags: mapping.labelTags, milestoneSprints: mapping.milestoneSprints })
      console.log(`Fetched ${issues.length} open issue(s) from ${target}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  }
  const { created, skippedDuplicates } = importTasks(store, inputs)
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
    if (!store.getTemplate(template)) {
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
  const { issues, ok } = lintProject(dir)
  if (ok) {
    console.log(`✔ ${path.join(dir, '.agentboard')} is healthy — no issues found.`)
    return 0
  }
  for (const issue of issues) {
    const icon = issue.severity === 'error' ? '✖' : '⚠'
    console.error(`${icon} ${issue.file}  [${issue.code}]  ${issue.message}`)
  }
  console.error(`\nFound ${issues.length} issue(s).`)
  return 1
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

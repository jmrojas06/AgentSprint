import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { ProjectStore, buildTaskSpec, buildBrandSection, hasBrand } from '@agentsprint/core'
import { startServer } from '@agentsprint/server'

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
  help              Show this help

Options (serve):
  --port <n>        Port to listen on (default: 4310)
  --host <ip>       Host to bind (default: 127.0.0.1)
  --no-open         Do not open the browser automatically
  --init            Auto-create a board if missing
  --version         Print the version
`)
}

interface Args {
  command: string
  dir: string
  taskId?: string
  port: number
  host: string
  open: boolean
  init: boolean
}

export function parseArgs(argv: string[]): Args | null {
  const commands = new Set(['init', 'serve', 'spec', 'brand', 'help'])
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
    return { command, dir: path.resolve(positional[0]!), taskId: positional[1], port, host, open, init }
  }

  if (command === 'brand') {
    if (positional.length > 1) {
      console.error('Usage: agentboard brand [dir]')
      process.exit(1)
    }
    return { command, dir: path.resolve(positional[0] ?? process.cwd()), port, host, open, init }
  }

  const dir = positional[0] ? path.resolve(positional[0]) : process.cwd()
  return { command, dir, port, host, open, init }
}

function resolveWebDist(): string | null {
  const candidates = [
    fileURLToPath(new URL('../../web/dist', import.meta.url)),
    path.resolve(process.cwd(), 'node_modules/@agentsprint/web/dist'),
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
  console.log(`✔ Sample tasks + AGENTS.md added. Edit the files or run:`)
  console.log(`\n  agentboard serve ${dir}\n`)
}

async function cmdServe(args: Args): Promise<void> {
  if (!fs.existsSync(path.join(args.dir, '.agentboard'))) {
    if (args.init) {
      ProjectStore.init(args.dir, { sample: true })
      console.log(`✔ Board auto-created in ${args.dir}`)
    } else {
      console.error(`No board found in ${args.dir}`)
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
  })

  console.log(`\n  AgentSprint v${VERSION}`)
  console.log(`  Board:   ${args.dir}`)
  console.log(`  Server:  ${url}`)
  if (webDist) {
    console.log(`  UI:      ${url}`)
  } else {
    console.log(`  UI:      build web with "pnpm --filter @agentsprint/web build"`)
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
  process.stdout.write(buildTaskSpec(task, sprint, state.config.name, state.brand) + '\n')
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
  } else {
    await cmdServe(args)
  }
}

const isEntry = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false
if (isEntry) {
  main().catch((err) => {
    console.error(`\n${(err as Error).message}`)
    process.exit(1)
  })
}

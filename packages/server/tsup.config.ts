import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const git = (cmd: string): string => {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// AGENTBOARD_COMMIT wins (Docker builds have no .git); otherwise ask git.
const commit = process.env.AGENTBOARD_COMMIT || (() => {
  const head = git('rev-parse --short HEAD')
  return head && git('status --porcelain') ? `${head}-dirty` : head
})()
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  define: {
    __AGENTBOARD_VERSION__: JSON.stringify(version),
    __AGENTBOARD_COMMIT__: JSON.stringify(commit),
    __AGENTBOARD_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
})

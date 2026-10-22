// Stamped by tsup (see tsup.config.ts); undefined when running from source (tests).
declare const __AGENTBOARD_VERSION__: string | undefined
declare const __AGENTBOARD_COMMIT__: string | undefined
declare const __AGENTBOARD_BUILT_AT__: string | undefined

export interface BuildInfo {
  version: string
  /** Short git commit the build came from, `-dirty` when it had uncommitted changes; null if unknown. */
  commit: string | null
  /** ISO time of the build; null if unknown. */
  builtAt: string | null
}

const stamped = (value: string | undefined): string | null => (typeof value === 'string' && value ? value : null)

/**
 * Which build of AgentSprint this server is. Served by `/api/health` and
 * printed at startup so a stale server (an old Docker image, a forgotten
 * `pnpm build`) is easy to tell apart from the current code.
 */
export const BUILD_INFO: BuildInfo = {
  version: typeof __AGENTBOARD_VERSION__ === 'string' ? __AGENTBOARD_VERSION__ : '0.2.0',
  commit: typeof __AGENTBOARD_COMMIT__ === 'string' ? stamped(__AGENTBOARD_COMMIT__) : null,
  builtAt: typeof __AGENTBOARD_BUILT_AT__ === 'string' ? stamped(__AGENTBOARD_BUILT_AT__) : null,
}

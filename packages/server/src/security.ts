/**
 * Browser-facing request guard: blocks cross-site requests (CSRF) and DNS
 * rebinding against the local board server.
 *
 * - Host: when the server is bound to loopback (the default), or allowed hosts
 *   are configured, the `Host` header must name loopback or an allowed host.
 *   A rebinding attack reaches 127.0.0.1 with `Host: attacker.example`.
 * - Origin: browsers send it on cross-origin fetches and on every non-GET
 *   request. It must be loopback, an allowed host/origin, or the server
 *   itself (same origin as `Host`). Non-browser clients (CLI, MCP agents,
 *   curl) send no Origin and are unaffected.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface RequestGuardOptions {
  /** Address the server binds to (default 127.0.0.1). */
  bindHost?: string
  /** Extra hostnames accepted in Host/Origin (e.g. a LAN name for Docker). */
  allowedHosts?: string[]
  /** Extra exact origins accepted in Origin (e.g. https://board.example.com). */
  allowedOrigins?: string[]
}

export interface RequestGuard {
  /** Rejection reason for the request, or null when it may proceed. */
  check(headers: { host?: string; origin?: string }): string | null
  /** False when bound to a non-loopback address without allowed hosts: Host is not checked. */
  readonly enforcesHost: boolean
}

/** Hostname part of a Host header value (`[::1]:4310` → `[::1]`, `Example.com:80` → `example.com`). */
export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1)
  return h.split(':')[0]!
}

export function isLoopbackHostname(name: string): boolean {
  return LOOPBACK.has(name.toLowerCase())
}

/** Comma-separated env var → trimmed non-empty list. */
export function listFromEnv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((v) => v.trim()).filter(Boolean)
}

export function createRequestGuard(opts: RequestGuardOptions = {}): RequestGuard {
  const allowedHosts = new Set((opts.allowedHosts ?? []).map((h) => hostnameOf(h)))
  const allowedOrigins = new Set((opts.allowedOrigins ?? []).map((o) => o.trim().replace(/\/$/, '').toLowerCase()))
  const enforcesHost = isLoopbackHostname(opts.bindHost ?? '127.0.0.1') || allowedHosts.size > 0
  const hostAllowed = (name: string) => isLoopbackHostname(name) || allowedHosts.has(name)

  return {
    enforcesHost,
    check({ host, origin }) {
      if (enforcesHost && (!host || !hostAllowed(hostnameOf(host)))) {
        return `Host not allowed: ${host ?? '(missing)'}`
      }
      if (origin === undefined) return null
      let url: URL
      try {
        url = new URL(origin)
      } catch {
        return `Origin not allowed: ${origin}` // includes the opaque "null" origin
      }
      const originHost = url.hostname.toLowerCase()
      const bracketed = originHost.includes(':') && !originHost.startsWith('[') ? `[${originHost}]` : originHost
      if (hostAllowed(bracketed)) return null
      if (allowedOrigins.has(url.origin.toLowerCase())) return null
      if (host && url.host.toLowerCase() === host.trim().toLowerCase()) return null // same origin
      return `Origin not allowed: ${origin}`
    },
  }
}

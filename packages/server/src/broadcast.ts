import type { FastifyReply } from 'fastify'

/** Simple SSE fan-out: multiple clients subscribe, one broadcaster. */
export class Broadcast {
  private clients = new Set<FastifyReply>()
  private readonly heartbeatMs: number
  private timer: NodeJS.Timeout | null = null

  constructor(heartbeatMs = 25_000) {
    this.heartbeatMs = heartbeatMs
  }

  subscribe(reply: FastifyReply): void {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write('retry: 3000\n\n')
    this.clients.add(reply)
    if (!this.timer) {
      this.timer = setInterval(() => this.ping(), this.heartbeatMs)
    }
    reply.raw.on('close', () => {
      this.clients.delete(reply)
      if (this.clients.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    })
  }

  send(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.clients) {
      client.raw.write(payload)
    }
  }

  private ping(): void {
    for (const client of this.clients) {
      client.raw.write(': ping\n\n')
    }
  }
}

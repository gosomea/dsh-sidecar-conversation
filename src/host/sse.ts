import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { SidecarRegistry } from './registry.js'

export class SidecarSseBroker {
  private readonly clients = new Map<string, Set<ServerResponse>>()
  private disposeListener: (() => void) | undefined

  constructor(private readonly ctx: Context, private readonly registry: SidecarRegistry) {}

  start(): void {
    this.disposeListener = this.ctx.on('session/event', (session: { id: SessionId }, event: SessionEvent) => {
      if (this.registry.getByChild(String(session.id)) === undefined) return
      this.publish(String(session.id), 'event', event, event.seq)
    })
  }

  connect(sessionId: string, req: IncomingMessage, res: ServerResponse): void {
    if (this.registry.getByChild(sessionId) === undefined) throw new Error('child Session is not registered as a Sidecar')
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write('event: ready\ndata: {}\n\n')
    let set = this.clients.get(sessionId)
    if (set === undefined) { set = new Set(); this.clients.set(sessionId, set) }
    set.add(res)
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000)
    const close = (): void => {
      clearInterval(heartbeat)
      set?.delete(res)
      if (set?.size === 0) this.clients.delete(sessionId)
    }
    req.once('close', close)
    res.once('close', close)
  }

  dispose(): void {
    this.disposeListener?.()
    for (const clients of this.clients.values()) for (const response of clients) response.end()
    this.clients.clear()
  }

  private publish(sessionId: string, eventName: string, payload: unknown, id?: number): void {
    const frame = `${id === undefined ? '' : `id: ${id}\n`}event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const response of this.clients.get(sessionId) ?? []) response.write(frame)
  }
}

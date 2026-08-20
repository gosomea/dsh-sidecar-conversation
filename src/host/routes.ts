import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { SIDECAR_API_PREFIX, type ArchiveSidecarInput, type CreateSidecarInput, type PromptSidecarInput } from '../core/types.js'
import { SidecarService } from './sidecar-service.js'
import { SidecarSseBroker } from './sse.js'
import { assertJsonRequest, assertTrustedSidecarRequest } from './request-trust.js'

const MAX_BODY_BYTES = 64 * 1024

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) throw new Error('JSON body is required')
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function route(
  method: 'GET' | 'POST',
  handler: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      assertTrustedSidecarRequest(req)
      if (req.method !== method) { sendJson(res, 405, { error: 'method not allowed' }); return }
      if (method === 'POST') assertJsonRequest(req)
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      await handler(req, res, url)
    } catch (error: unknown) {
      if (!res.headersSent) sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      else res.end()
    }
  }
}

export function registerRoutes(webServer: WebServer, service: SidecarService, broker: SidecarSseBroker): () => void {
  const disposers = [
    webServer.register({ kind: 'exact', path: `${SIDECAR_API_PREFIX}/list`, handler: route('GET', (_req, res, url) => {
      const parentSessionId = url.searchParams.get('parentSessionId') ?? ''
      const includeArchived = url.searchParams.get('includeArchived') === 'true'
      sendJson(res, 200, { items: service.list(parentSessionId, includeArchived) })
    }) }),
    webServer.register({ kind: 'exact', path: `${SIDECAR_API_PREFIX}/create`, handler: route('POST', async (req, res) => {
      sendJson(res, 200, { record: await service.create(await readJson<CreateSidecarInput>(req)) })
    }) }),
    webServer.register({ kind: 'exact', path: `${SIDECAR_API_PREFIX}/prompt`, handler: route('POST', async (req, res) => {
      sendJson(res, 200, await service.prompt(await readJson<PromptSidecarInput>(req)))
    }) }),
    webServer.register({ kind: 'exact', path: `${SIDECAR_API_PREFIX}/archive`, handler: route('POST', async (req, res) => {
      sendJson(res, 200, { record: await service.archive(await readJson<ArchiveSidecarInput>(req)) })
    }) }),
    webServer.register({ kind: 'exact', path: `${SIDECAR_API_PREFIX}/events`, handler: route('GET', (req, res, url) => {
      broker.connect(url.searchParams.get('sessionId') ?? '', req, res)
    }) }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

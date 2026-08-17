import { SIDECAR_API_PREFIX, type ArchiveSidecarInput, type CreateSidecarInput, type PromptSidecarInput, type SidecarRecord } from '../core/types.js'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SIDECAR_API_PREFIX}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

export class SidecarApi {
  async list(parentSessionId: string): Promise<SidecarRecord[]> {
    const result = await json<{ items: SidecarRecord[] }>(`/list?parentSessionId=${encodeURIComponent(parentSessionId)}`)
    return result.items
  }
  async create(input: CreateSidecarInput): Promise<SidecarRecord> {
    return (await json<{ record: SidecarRecord }>('/create', { method: 'POST', body: JSON.stringify(input) })).record
  }
  async prompt(input: PromptSidecarInput): Promise<{ accepted: true; rpcId: string }> {
    return json('/prompt', { method: 'POST', body: JSON.stringify(input) })
  }
  async archive(input: ArchiveSidecarInput): Promise<SidecarRecord> {
    return (await json<{ record: SidecarRecord }>('/archive', { method: 'POST', body: JSON.stringify(input) })).record
  }
  events(childSessionId: string): EventSource {
    return new EventSource(`${SIDECAR_API_PREFIX}/events?sessionId=${encodeURIComponent(childSessionId)}`)
  }
}

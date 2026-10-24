import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { SidecarRegistry } from '../src/host/registry.js'
import { SidecarService } from '../src/host/sidecar-service.js'
import type { HistoryEvent } from '../src/core/types.js'
import type { SidecarAccessBoundary } from '../src/host/access.js'

export async function fixture(options: { promptPersistenceDelayMs?: number; sourceText?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sidecar-service-'))
  const registry = new SidecarRegistry(join(root, 'registry.json'))
  await registry.load()
  const events = new Map<string, HistoryEvent[]>([['parent', [
    { type: 'assistant/message', seq: 7, data: { message: { id: 'assistant-1', content: [{ type: 'text', text: options.sourceText ?? 'selected source text' }] } } },
    { type: 'turn/end', seq: 8 },
  ]]])
  let independentCreates = 0
  let forks = 0
  let prompts = 0
  let archives = 0
  let loads = 0
  const forkSeqs: number[] = []
  const historyCalls = new Map<string, number>()
  const appliedModes: string[] = []
  const promptTexts: string[] = []
  const sessions = {
    createIndependent: async (request: { payload: { sessionId: string } }) => {
      independentCreates++
      events.set(request.payload.sessionId, [])
      return { result: { ok: true, value: { sessionId: request.payload.sessionId } } }
    },
    history: async (request: { rpcId: string; payload: { sessionId: string } }) => {
      const sessionId = request.payload.sessionId
      historyCalls.set(sessionId, (historyCalls.get(sessionId) ?? 0) + 1)
      return { rpcId: request.rpcId, result: { ok: true, value: { events: (events.get(sessionId) ?? []).map(event => ({ event })), hasMore: false } } }
    },
    fork: async (request: { rpcId: string; payload: { atSeq: number } }) => { forks++; forkSeqs.push(request.payload.atSeq); events.set('child', [...(events.get('parent') ?? [])]); return { rpcId: request.rpcId, result: { ok: true, value: { sessionId: 'child' } } } },
    rename: async (request: { rpcId: string; payload: { title: string } }) => ({ rpcId: request.rpcId, result: { ok: true, value: { title: request.payload.title, seq: 9 } } }),
    prompt: async (request: { rpcId: string; payload: { sessionId: string; content: unknown[] } }) => {
      prompts++
      promptTexts.push(JSON.stringify(request.payload.content))
      const persist = () => {
        events.get(request.payload.sessionId)?.push({ type: 'user/message', seq: 10, data: { message: { source: { rpcId: request.rpcId }, content: request.payload.content } } })
      }
      if (options.promptPersistenceDelayMs === undefined) persist()
      else setTimeout(persist, options.promptPersistenceDelayMs)
      return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } }
    },
    models: async (request: { rpcId: string; payload: { sessionId: string } }) => {
      loads++
      return { rpcId: request.rpcId, result: { ok: true, value: { current: {}, routable: true, groups: [], failures: [] } } }
    },
  }
  const workspace = {
    ensureUsable: async (request: { rpcId: string; payload: { sessionId: string } }) => {
      archives++
      return { rpcId: request.rpcId, result: { ok: true, value: { archivedSessionIds: [request.payload.sessionId] } } }
    },
  }
  const access: SidecarAccessBoundary = {
    apply: (_childSessionId, mode) => {
      appliedModes.push(mode)
      return mode === 'read-only'
        ? { mode, effectiveSandbox: 'read-only', effectiveApproval: 'ask' }
        : { mode, effectiveSandbox: 'workspace-write', effectiveApproval: 'ask' }
    },
    assert: record => {
      if (record.access.mode === 'read-only'
        && (record.access.effectiveSandbox !== 'read-only' || record.access.effectiveApproval !== 'ask')) {
        throw new Error('read-only policy drift')
      }
    },
  }
  const service = new SidecarService({ sessions, workspace } as unknown as ApiProxy, registry, access)
  return {
    service, registry, events, root,
    independentCount: () => independentCreates,
    counts: () => ({ forks, prompts, archives }),
    loadCount: () => loads,
    historyCount: (sessionId: string) => historyCalls.get(sessionId) ?? 0,
    forkSeqs,
    promptTexts,
    appliedModes,
  }
}


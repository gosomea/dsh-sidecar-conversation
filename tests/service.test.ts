import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { SidecarRegistry } from '../src/host/registry.js'
import { SidecarService } from '../src/host/sidecar-service.js'
import type { HistoryEvent } from '../src/core/types.js'
import type { SidecarAccessBoundary } from '../src/host/access.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sidecar-service-'))
  const registry = new SidecarRegistry(join(root, 'registry.json'))
  await registry.load()
  const events = new Map<string, HistoryEvent[]>([['parent', [
    { type: 'assistant/message', seq: 7, data: { message: { id: 'assistant-1', content: [{ type: 'text', text: 'selected source text' }] } } },
    { type: 'turn/end', seq: 8 },
  ]]])
  let forks = 0
  let prompts = 0
  let archives = 0
  const appliedModes: string[] = []
  const promptTexts: string[] = []
  const sessions = {
    history: async (request: { rpcId: string; payload: { sessionId: string } }) => ({ rpcId: request.rpcId, result: { ok: true, value: { events: (events.get(request.payload.sessionId) ?? []).map(event => ({ event })), hasMore: false } } }),
    fork: async (request: { rpcId: string }) => { forks++; events.set('child', [...(events.get('parent') ?? [])]); return { rpcId: request.rpcId, result: { ok: true, value: { sessionId: 'child' } } } },
    rename: async (request: { rpcId: string; payload: { title: string } }) => ({ rpcId: request.rpcId, result: { ok: true, value: { title: request.payload.title, seq: 9 } } }),
    prompt: async (request: { rpcId: string; payload: { sessionId: string; content: unknown[] } }) => {
      prompts++
      promptTexts.push(JSON.stringify(request.payload.content))
      events.get(request.payload.sessionId)?.push({ type: 'user/message', seq: 10, data: { message: { source: { rpcId: request.rpcId }, content: request.payload.content } } })
      return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } }
    },
  }
  const workspace = {
    archiveSession: async (request: { rpcId: string; payload: { sessionId: string } }) => {
      archives++
      return { rpcId: request.rpcId, result: { ok: true, value: { archivedSessionIds: [request.payload.sessionId] } } }
    },
  }
  const access: SidecarAccessBoundary = {
    apply: (_childSessionId, mode) => {
      appliedModes.push(mode)
      return mode === 'read-only'
        ? { mode, effectiveSandbox: 'read-only', effectiveApproval: 'never' }
        : { mode, effectiveSandbox: 'workspace-write', effectiveApproval: 'ask' }
    },
    assert: record => {
      if (record.access.mode === 'read-only'
        && (record.access.effectiveSandbox !== 'read-only' || record.access.effectiveApproval !== 'never')) {
        throw new Error('read-only policy drift')
      }
    },
  }
  const service = new SidecarService({ sessions, workspace } as unknown as ApiProxy, registry, access)
  return { service, counts: () => ({ forks, prompts, archives }), promptTexts, appliedModes }
}

describe('SidecarService idempotency and source validation', () => {
  const input = { parentSessionId: 'parent', requestKey: 'create-1', sourceMessageId: 'assistant-1', sourceSeq: 7, quote: 'source text', question: 'why?' }

  it('coalesces concurrent create retries into one fork and one prompt', async () => {
    const { service, counts, promptTexts } = await fixture()
    const [a, b] = await Promise.all([service.create(input), service.create(input)])
    expect(a.childSessionId).toBe(b.childSessionId)
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 1 })
  })

  it('applies and records read-only policy before activating the Sidecar', async () => {
    const { service, appliedModes } = await fixture()
    const record = await service.create({ ...input, accessMode: 'read-only' })
    expect(appliedModes).toEqual(['read-only'])
    expect(record.status).toBe('active')
    expect(record.access).toEqual({ mode: 'read-only', effectiveSandbox: 'read-only', effectiveApproval: 'never' })
  })

  it('rejects a quote that does not belong to the addressed message', async () => {
    const { service, counts } = await fixture()
    await expect(service.create({ ...input, quote: 'different text' })).rejects.toThrow(/do not match/)
    expect(counts()).toEqual({ forks: 0, prompts: 0, archives: 0 })
  })

  it('forks a complete turn without inventing a quote payload', async () => {
    const { service, counts, promptTexts } = await fixture()
    const record = await service.create({ ...input, requestKey: 'turn-1', sourceKind: 'turn', quote: '' })
    expect(record.sourceKind).toBe('turn')
    expect(record.title).toBe('↳ 侧问 · 整个回合')
    expect(promptTexts[0]).not.toContain('sidecar_quote')
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 1 })
  })

  it('infers a whole-turn source for an empty legacy quote', async () => {
    const { service } = await fixture()
    const record = await service.create({ ...input, requestKey: 'turn-legacy', quote: '' })
    expect(record.sourceKind).toBe('turn')
    expect(record.quote).toBe('')
  })

  it('deduplicates prompt retries by their stable request key', async () => {
    const { service, counts, promptTexts } = await fixture()
    const record = await service.create(input)
    await Promise.all([
      service.prompt({ childSessionId: record.childSessionId, requestKey: 'next-1', question: 'next' }),
      service.prompt({ childSessionId: record.childSessionId, requestKey: 'next-1', question: 'next' }),
    ])
    expect(counts()).toEqual({ forks: 1, prompts: 2, archives: 1 })
    expect(promptTexts[1]).toContain('<sidecar_question>')
  })

  it('reuses a Sidecar with a newly validated parent selection as context', async () => {
    const { service, counts, promptTexts } = await fixture()
    const record = await service.create(input)
    await service.prompt({
      childSessionId: record.childSessionId, requestKey: 'selection-follow-up', question: 'explain this',
      source: { sourceMessageId: 'assistant-1', sourceSeq: 7, sourceKind: 'selection', quote: 'selected source' },
    })
    expect(promptTexts[1]).toContain('<sidecar_context kind=\\"selection\\">\\nselected source')
    expect(promptTexts[1]).toContain('用户问题：\\nexplain this')
    expect(counts()).toEqual({ forks: 1, prompts: 2, archives: 1 })
  })

  it('rejects unverified context before appending it to an existing Sidecar', async () => {
    const { service, counts } = await fixture()
    const record = await service.create(input)
    await expect(service.prompt({
      childSessionId: record.childSessionId, requestKey: 'bad-context', question: 'explain this',
      source: { sourceMessageId: 'assistant-1', sourceSeq: 7, sourceKind: 'selection', quote: 'not in the message' },
    })).rejects.toThrow(/do not match/)
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 1 })
  })

  it('reasserts sidebar hiding when a create request is retried', async () => {
    const { service, counts } = await fixture()
    await service.create(input)
    await service.create(input)
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 2 })
  })

  it('hides records loaded from an earlier plugin version', async () => {
    const { service, counts } = await fixture()
    await service.create(input)
    await service.recoverRegistered()
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 2 })
  })
})

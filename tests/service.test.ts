import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { SidecarRegistry } from '../src/host/registry.js'
import { SidecarService } from '../src/host/sidecar-service.js'
import type { HistoryEvent } from '../src/core/types.js'
import type { SidecarAccessBoundary } from '../src/host/access.js'

async function fixture(options: { promptPersistenceDelayMs?: number; sourceText?: string } = {}) {
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

describe('SidecarService idempotency and source validation', () => {
  const input = {
    parentSessionId: 'parent', requestKey: 'create-1', sourceMessageId: 'assistant-1', sourceSeq: 7,
    quote: 'source text', question: 'why?', accessMode: 'read-only' as const,
  }

  it('coalesces concurrent create retries into one fork and one prompt', async () => {
    const { service, counts, promptTexts } = await fixture()
    const [a, b] = await Promise.all([service.create(input), service.create(input)])
    expect(a.childSessionId).toBe(b.childSessionId)
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 1 })
  })

  it('normalizes parent and request identities before coalescing create flights', async () => {
    const { service, counts } = await fixture()
    const [a, b] = await Promise.all([
      service.create({ ...input, parentSessionId: '  parent  ', requestKey: '\tcreate-1\n' }),
      service.create(input),
    ])

    expect(a.childSessionId).toBe(b.childSessionId)
    expect(a.parentSessionId).toBe('parent')
    expect(a.requestKey).toBe('create-1')
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 1 })
  })

  it('applies and records read-only policy before activating the Sidecar', async () => {
    const { service, appliedModes, loadCount } = await fixture()
    const record = await service.create({ ...input, accessMode: 'read-only' })
    expect(loadCount()).toBe(1)
    expect(appliedModes).toEqual(['read-only'])
    expect(record.status).toBe('active')
    expect(record.access).toEqual({ mode: 'read-only', effectiveSandbox: 'read-only', effectiveApproval: 'ask' })
  })

  it('activates after enqueue without polling for durable first-prompt history', async () => {
    const { service, historyCount } = await fixture({ promptPersistenceDelayMs: 25 })
    const record = await service.create(input)
    expect(record.status).toBe('active')
    // A fresh atomic receipt proves this prompt has never been admitted, so
    // the normal path never scans child history or waits for durability.
    expect(historyCount(record.childSessionId)).toBe(0)
  })

  it('does not replay an accepted first prompt while its history is catching up', async () => {
    const { service, counts } = await fixture({ promptPersistenceDelayMs: 25 })
    await service.create(input)
    await service.create(input)
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 2 })
  })

  it('rejects create requests that omit the explicit access choice', async () => {
    const { service, counts } = await fixture()
    await expect(service.create({ ...input, accessMode: undefined as never })).rejects.toThrow(/accessMode/)
    expect(counts()).toEqual({ forks: 0, prompts: 0, archives: 0 })
  })

  it('rejects reuse of a request key with a different payload', async () => {
    const { service, counts } = await fixture()
    await service.create(input)
    await expect(service.create({ ...input, question: 'a different question' })).rejects.toThrow(/different Sidecar request/)
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 1 })
  })

  it('rejects a quote that does not belong to the addressed message', async () => {
    const { service, counts } = await fixture()
    await expect(service.create({ ...input, quote: 'different text' })).rejects.toThrow(/不一致/)
    expect(counts()).toEqual({ forks: 0, prompts: 0, archives: 0 })
  })

  it('treats client seq as a hint and forks at the durable Assistant event seq', async () => {
    const { service, forkSeqs } = await fixture()
    const record = await service.create({ ...input, sourceSeq: 8 })
    expect(record.sourceSeq).toBe(7)
    expect(forkSeqs).toEqual([7])
  })

  it('accepts an idempotent retry when only the client seq hint changed', async () => {
    const { service, counts } = await fixture()
    await service.create(input)
    await service.create({ ...input, sourceSeq: 8 })
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 2 })
  })

  it('forks a complete turn without inventing a quote payload', async () => {
    const { service, counts, promptTexts } = await fixture()
    const record = await service.create({ ...input, requestKey: 'turn-1', sourceKind: 'turn', quote: '' })
    expect(record.sourceKind).toBe('turn')
    expect(record.title).toBe('why?')
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
    const { service, counts, promptTexts, historyCount } = await fixture()
    const record = await service.create(input)
    await Promise.all([
      service.prompt({ childSessionId: record.childSessionId, requestKey: 'next-1', question: 'next' }),
      service.prompt({ childSessionId: record.childSessionId, requestKey: 'next-1', question: 'next' }),
    ])
    expect(counts()).toEqual({ forks: 1, prompts: 2, archives: 1 })
    expect(promptTexts[1]).toContain('<sidecar_question>')
    expect(historyCount(record.childSessionId)).toBe(0)
  })

  it('rejects concurrent reuse of a prompt request key with different text', async () => {
    const { service } = await fixture()
    const record = await service.create(input)
    const first = service.prompt({ childSessionId: record.childSessionId, requestKey: 'same-key', question: 'first' })
    await expect(service.prompt({ childSessionId: record.childSessionId, requestKey: 'same-key', question: 'second' }))
      .rejects.toThrow(/different Sidecar prompt/)
    await first
  })

  it('rejects durable reuse of a prompt request key with different text', async () => {
    const { service, counts } = await fixture()
    const record = await service.create(input)
    await service.prompt({ childSessionId: record.childSessionId, requestKey: 'same-key', question: 'first' })
    await expect(service.prompt({ childSessionId: record.childSessionId, requestKey: 'same-key', question: 'second' }))
      .rejects.toThrow(/different Sidecar prompt/)
    expect(counts().prompts).toBe(2)
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
    })).rejects.toThrow(/不一致/)
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 1 })
  })

  it('restores runnable state when a create request is retried', async () => {
    const { service, counts } = await fixture()
    await service.create(input)
    await service.create(input)
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 2 })
  })

  it('restores records loaded from an earlier plugin version', async () => {
    const { service, counts } = await fixture()
    await service.create(input)
    await service.recoverRegistered()
    expect(counts()).toEqual({ forks: 1, prompts: 1, archives: 2 })
  })

  it('resumes a cold registered child before applying or asserting access policy', async () => {
    const { service, loadCount } = await fixture()
    const record = await service.create(input)
    await service.prompt({ childSessionId: record.childSessionId, requestKey: 'after-restart', question: 'continue' })
    expect(loadCount()).toBe(2)
  })

  it('paginates a very large streaming event page without overflowing the call stack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-large-history-'))
    const registry = new SidecarRegistry(join(root, 'registry.json'))
    await registry.load()
    const largePage = Array.from({ length: 140_000 }, (_, index): HistoryEvent => ({
      type: 'assistant/delta', seq: index + 1, data: { text: 'x' },
    }))
    let page = 0
    const api = {
      sessions: { history: async (request: { rpcId: string }) => {
        const value = page++ === 0
          ? { events: largePage.map(event => ({ event })), hasMore: true }
          : { events: [], hasMore: false }
        return { rpcId: request.rpcId, result: { ok: true, value } }
      } },
    } as unknown as ApiProxy
    const access = { apply: () => ({ mode: 'inherit' as const }), assert: () => undefined }
    const service = new SidecarService(api, registry, access)
    await expect(service.history('large')).resolves.toHaveLength(largePage.length)
  })
})

describe('sidecar topic titles', () => {
  const input = { parentSessionId: 'parent', requestKey: 'title-case', sourceMessageId: 'assistant-1', sourceSeq: 7, quote: 'source text', question: 'Why does persistence work?', accessMode: 'read-only' as const }
  it('persists the first question as the title and upgrades legacy defaults', async () => {
    const f = await fixture()
    const record = await f.service.create(input)
    expect(record.title).toBe('Why does persistence work?')
    await f.registry.setTitle(record.childSessionId, '↳ 侧问 · source text')
    await f.service.recoverRegistered()
    expect(f.registry.all()[0]?.title).toBe(record.title)
    await f.service.recoverRegistered()
    expect(f.registry.all()[0]?.title).toBe(record.title)
  })
  it('preserves a native custom title when upgrading a legacy record', async () => {
    const f = await fixture()
    const record = await f.service.create(input)
    await f.registry.setTitle(record.childSessionId, '↳ 侧问 · source text')
    f.events.get('child')!.push({ type: 'session/title', seq: 99, data: { title: 'My custom title' } })
    await f.service.recoverRegistered()
    expect(f.registry.all()[0]?.title).toBe('My custom title')
  })
})

describe('independent conversations and history entry', () => {
  const input = { parentSessionId: 'parent', requestKey: 'independent-case', sourceMessageId: 'assistant-1', sourceSeq: 7, quote: 'source text', question: 'Explain just this quote', accessMode: 'read-only' as const, creationMode: 'independent' as const }
  it('creates a fresh session instead of forking and sends only the explicit quote and question', async () => {
    const f = await fixture()
    const record = await f.service.create(input)
    expect(record.creationMode).toBe('independent')
    const restored = new SidecarRegistry(join(f.root, 'registry.json'))
    await restored.load()
    expect(restored.getByChild(record.childSessionId)?.creationMode).toBe('independent')
    expect(f.independentCount()).toBe(1)
    expect(f.counts().forks).toBe(0)
    expect(f.events.get(record.childSessionId)?.some(event => event.type === 'assistant/message')).toBe(false)
    expect(f.promptTexts[0]).toContain('source text')
    expect(f.promptTexts[0]).toContain('Explain just this quote')
    expect(f.promptTexts[0]).not.toContain('selected source text')
    expect(await f.service.create(input)).toEqual(record)
    expect(f.independentCount()).toBe(1)
    await expect(f.service.create({ ...input, creationMode: 'fork' })).rejects.toThrow('creation mode')
  })
  it('resolves the latest stored answer for the history create button and explains an empty parent', async () => {
    const f = await fixture()
    expect(await f.service.latestSource('parent')).toEqual({ sourceMessageId: 'assistant-1', sourceSeq: 7 })
    await expect(f.service.latestSource('empty')).rejects.toThrow('还没有已完成的回答')
  })
})


describe('native reference serialization', () => {
  it('resolves the stable message identity and uses the durable sequence', async () => {
    const { service } = await fixture()
    const text = await service.serializeReference({ parentSessionId: 'parent', sourceMessageId: 'assistant-1', sourceSeq: 0, sourceKind: 'turn', quote: '' })
    expect(text).toContain('"sourceSeq":7')
    expect(text).toContain('selected source text')
  })
  it('refuses stale or foreign quoted material before native submission', async () => {
    const { service } = await fixture()
    await expect(service.serializeReference({ parentSessionId: 'parent', sourceMessageId: 'assistant-1', sourceSeq: 7, sourceKind: 'selection', quote: 'not in source' })).rejects.toThrow('请移除该引用后重新选择')
    await expect(service.serializeReference({ parentSessionId: 'parent', sourceMessageId: 'missing', sourceSeq: 7, sourceKind: 'turn', quote: '' })).rejects.toThrow('找不到')
  })
})

it('serializes a multi-block browser selection while retaining its canonical source', async () => {
  const { service } = await fixture({ sourceText: '第一段 **内容**。\n\n1. 第一项；\n2. 第二项。' })
  const ref = { parentSessionId: 'parent', sourceMessageId: 'assistant-1', sourceSeq: 0, sourceKind: 'selection' as const, quote: '内容。\n第一项；\n\n第二项' }
  const wire = await service.serializeReference(ref)
  expect(wire).toContain('"sourceSeq":7')
  expect(wire).toContain(JSON.stringify(ref.quote))
  await expect(service.serializeReference({ ...ref, quote: '内容。第一项；第三项' })).rejects.toThrow('请移除该引用后重新选择')
})

const nativeInput = { parentSessionId: 'parent', requestKey: 'native-prepare', sourceMessageId: 'assistant-1', sourceSeq: 7, sourceKind: 'turn' as const, quote: '', question: 'why', accessMode: 'read-only' as const }
it('prepares exactly one native Session without sending, including recovery and retries', async () => {
  const { service, counts, registry } = await fixture()
  const [a, b] = await Promise.all([service.prepare(nativeInput), service.prepare(nativeInput)])
  expect(a.childSessionId).toBe(b.childSessionId)
  expect(a.nativeComposer).toBe(true)
  expect(a.firstQuestion).toBe('')
  expect(counts().forks).toBe(1)
  expect(counts().prompts).toBe(0)
  await service.recoverRegistered()
  expect(counts().prompts).toBe(0)
  const restored = new SidecarRegistry(registry.filename); await restored.load()
  expect(restored.getByChild(a.childSessionId)?.nativeComposer).toBe(true)
  await expect(service.create(nativeInput)).rejects.toThrow('another creation flow')
})
it('records the first native user question but ignores injected runtime messages', async () => {
  const { service, registry, counts } = await fixture()
  const r = await service.prepare(nativeInput)
  await service.noteNativeEvent(r.childSessionId, { type: 'user/message', seq: 20, data: { source: { kind: 'runtime' }, content: [{ type: 'text', text: 'injected' }] } })
  expect(registry.getByChild(r.childSessionId)?.firstQuestion).toBe('')
  await service.noteNativeEvent(r.childSessionId, { type: 'user/message', seq: 21, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '新问题' }] } })
  expect(registry.getByChild(r.childSessionId)?.title).toContain('新问题')
  expect(counts().prompts).toBe(0)
})
it('keeps a native name chosen before first send and syncs legacy rename events', async () => {
  const { service, registry } = await fixture()
  const modern = await service.prepare(nativeInput)
  await service.noteNativeEvent(modern.childSessionId, { type: 'session/title', seq: 20, data: { title: 'work1' } })
  await service.noteNativeEvent(modern.childSessionId, { type: 'user/message', seq: 21, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'different question' }] } })
  expect(registry.getByChild(modern.childSessionId)?.title).toBe('work1')
  const old = await fixture()
  const legacy = await old.service.create({ ...nativeInput, requestKey: 'legacy-title' })
  await old.service.noteNativeEvent(legacy.childSessionId, { type: 'session/title', seq: 30, data: { title: 'legacy renamed' } })
  expect(old.registry.getByChild(legacy.childSessionId)?.title).toBe('legacy renamed')
})

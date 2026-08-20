import { createHash } from 'node:crypto'
import type { ApiProxy, HistoryEntry, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { assistantMessage, eventRpcId, hasPromptRpcId, minimumEventSeq, userMessageText } from '../core/transcript.js'
import { normalizeQuestion, normalizeQuote, quoteTitle, textContainsQuote, wrapContextQuestion, wrapFirstQuestion, wrapSidecarQuestion } from '../core/quote.js'
import type { ArchiveSidecarInput, CreateSidecarInput, HistoryEvent, PromptSidecarInput, SidecarAccessMode, SidecarRecord } from '../core/types.js'
import type { SidecarAccessBoundary } from './access.js'
import { SidecarRegistry } from './registry.js'

function stableRpcId(kind: string, key: string): ReturnType<typeof RpcId> {
  return RpcId(`sidecar-${kind}-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`)
}

function normalizeIdentity(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function createFlightKey(input: CreateSidecarInput): string {
  // Use the exact same normalized values that createInternal persists. This
  // prevents retries that differ only by surrounding whitespace from forking
  // two children while the first request is still in flight.
  return JSON.stringify([
    normalizeIdentity(input?.parentSessionId),
    normalizeIdentity(input?.requestKey),
  ])
}

function unwrap<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
  return response.result.value
}

async function forEachBounded<T>(items: readonly T[], concurrency: number, visit: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item !== undefined) await visit(item)
    }
  })
  await Promise.all(workers)
}

export class SidecarService {
  private readonly createFlights = new Map<string, Promise<SidecarRecord>>()
  private readonly promptFlights = new Map<string, { text: string; task: Promise<void> }>()

  constructor(
    private readonly api: ApiProxy,
    readonly registry: SidecarRegistry,
    private readonly access: SidecarAccessBoundary,
  ) {}

  async recoverRegistered(): Promise<void> {
    await forEachBounded(this.registry.all(), 4, async (record) => {
      try {
        await this.ensureHidden(record.childSessionId)
        if (record.status === 'provisioning') await this.finishProvisioning(record)
      }
      catch { /* A deleted legacy child must not prevent the plugin from booting. */ }
    })
  }

  list(parentSessionId: string, includeArchived = false): SidecarRecord[] {
    if (!parentSessionId) throw new Error('parentSessionId is required')
    return this.registry.list(parentSessionId, includeArchived)
  }

  async create(input: CreateSidecarInput): Promise<SidecarRecord> {
    const flightKey = createFlightKey(input)
    const pending = this.createFlights.get(flightKey)
    if (pending !== undefined) return pending
    const task = this.createInternal(input).finally(() => { this.createFlights.delete(flightKey) })
    this.createFlights.set(flightKey, task)
    return task
  }

  private async createInternal(input: CreateSidecarInput): Promise<SidecarRecord> {
    this.registry.ensureWritable()
    const parentSessionId = normalizeIdentity(input?.parentSessionId)
    const requestKey = normalizeIdentity(input?.requestKey)
    const sourceMessageId = normalizeIdentity(input?.sourceMessageId)
    if (!parentSessionId || !requestKey || !sourceMessageId
      || !Number.isSafeInteger(input?.sourceSeq) || input.sourceSeq < 0) {
      throw new Error('parentSessionId, requestKey, sourceMessageId and non-negative safe integer sourceSeq are required')
    }
    if (input.sourceKind !== undefined && input.sourceKind !== 'selection' && input.sourceKind !== 'turn') {
      throw new Error('sourceKind must be selection or turn')
    }
    const accessMode: SidecarAccessMode = input.accessMode
    if (accessMode !== 'read-only' && accessMode !== 'inherit') throw new Error('accessMode must be read-only or inherit')
    // Empty quotes are emitted only by whole-turn drafts. Inferring that mode keeps
    // the endpoint compatible with clients/boundaries that predate sourceKind.
    const sourceKind = input.sourceKind ?? (typeof input.quote === 'string' && input.quote.trim() === '' ? 'turn' : 'selection')
    const quote = sourceKind === 'turn' ? '' : normalizeQuote(typeof input.quote === 'string' ? input.quote : '')
    const question = normalizeQuestion(typeof input.question === 'string' ? input.question : '')
    const existing = this.registry.getByRequest(parentSessionId, requestKey)
    if (existing !== undefined) {
      if (existing.access.mode !== accessMode) throw new Error('requestKey is already bound to a different Sidecar access mode')
      const existingSourceKind = existing.sourceKind ?? (existing.quote === '' ? 'turn' : 'selection')
      if (existing.sourceMessageId !== sourceMessageId
        || existingSourceKind !== sourceKind
        || existing.quote !== quote
        || existing.firstQuestion !== question) {
        throw new Error('requestKey is already bound to a different Sidecar request')
      }
      if (existing.status === 'provisioning') return this.finishProvisioning(existing)
      await this.ensureHidden(existing.childSessionId)
      await this.ensureLoaded(existing.childSessionId)
      this.access.assert(existing)
      // An active record means the first prompt was already accepted and the
      // registry was activated. Do not replay it when a client retries after a
      // lost response; the durable user/message may still be catching up.
      return existing
    }

    const source = await this.resolveAssistantSource(parentSessionId, sourceMessageId)
    if (sourceKind === 'selection' && !textContainsQuote(source.text, quote)) {
      throw new Error('选中的文字与父会话中的 Assistant 消息不一致，请重新选择后再发送')
    }

    const forked = unwrap(await this.api.sessions.fork({
      rpcId: stableRpcId('fork', `${parentSessionId}:${requestKey}`),
      payload: { sessionId: parentSessionId as SessionId, atSeq: source.seq },
    }))
    const childSessionId = String(forked.sessionId)
    const title = quoteTitle(quote, sourceKind)
    const firstPromptRpcId = String(stableRpcId('first-prompt', `${parentSessionId}:${requestKey}`))
    const now = Date.now()
    const record: SidecarRecord = {
      parentSessionId,
      childSessionId,
      requestKey,
      sourceMessageId,
      sourceSeq: source.seq,
      sourceKind,
      quote,
      firstQuestion: question,
      firstPromptRpcId,
      access: { mode: accessMode },
      title,
      createdAt: now,
      updatedAt: now,
      status: 'provisioning',
    }
    await this.registry.add(record)
    return this.finishProvisioning(record)
  }

  private async finishProvisioning(record: SidecarRecord): Promise<SidecarRecord> {
    // Sidecars are implementation sessions, not primary navigation entries.
    // Harness' archive registry hides them from every sidebar grouping while
    // keeping their history, runtime binding and background work intact.
    await this.ensureHidden(record.childSessionId)
    await this.ensureLoaded(record.childSessionId)
    let access
    try {
      access = this.access.apply(record.childSessionId, record.access.mode)
    } catch (error: unknown) {
      throw new Error(`Sidecar 权限恢复失败：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    const applied = { ...record, access }
    this.access.assert(applied)
    try {
      unwrap(await this.api.sessions.rename({
        rpcId: stableRpcId('rename', record.childSessionId),
        payload: { sessionId: record.childSessionId as SessionId, title: record.title },
      }))
    } catch { /* title is best effort; the registry remains authoritative */ }
    await this.ensurePrompt(record.childSessionId, record.firstPromptRpcId,
      wrapFirstQuestion(record.quote, record.firstQuestion, record.sourceKind))
    return this.registry.activate(record.childSessionId, access)
  }

  async prompt(input: PromptSidecarInput): Promise<{ accepted: true; rpcId: string }> {
    const record = this.requireChild(input.childSessionId)
    if (record.status !== 'active') throw new Error('Sidecar is still being provisioned')
    await this.ensureLoaded(record.childSessionId)
    this.access.assert(record)
    const requestKey = input.requestKey.trim()
    if (!requestKey) throw new Error('requestKey is required')
    const question = normalizeQuestion(input.question)
    const rpcId = String(stableRpcId('prompt', `${record.childSessionId}:${requestKey}`))
    const source = input.source
    const text = source === undefined ? wrapSidecarQuestion(question) : await this.contextPrompt(record, source, question)
    await this.ensurePrompt(record.childSessionId, rpcId, text)
    return { accepted: true, rpcId }
  }

  private async contextPrompt(record: SidecarRecord, source: NonNullable<PromptSidecarInput['source']>, question: string): Promise<string> {
    const sourceMessageId = normalizeIdentity(source.sourceMessageId)
    if (!sourceMessageId || !Number.isSafeInteger(source.sourceSeq) || source.sourceSeq < 0
      || (source.sourceKind !== 'selection' && source.sourceKind !== 'turn')) {
      throw new Error('sourceMessageId, non-negative safe integer sourceSeq and sourceKind are required')
    }
    const assistant = await this.resolveAssistantSource(record.parentSessionId, sourceMessageId)
    const context = source.sourceKind === 'turn'
      ? assistant.text
      : normalizeQuote(typeof source.quote === 'string' ? source.quote : '')
    if (source.sourceKind === 'selection' && !textContainsQuote(assistant.text, context)) {
      throw new Error('选中的文字与父会话中的 Assistant 消息不一致，请重新选择后再发送')
    }
    return wrapContextQuestion(context, question, source.sourceKind)
  }

  /**
   * Resolve a finalized Assistant message by its durable identity.
   *
   * The client-side conversation projection exposes a seq as a useful fork
   * hint, but projections and paged history can disagree at a boundary. The
   * message id is the stable identity; the durable event supplies the
   * canonical seq used for forking and persistence.
   */
  private async resolveAssistantSource(sessionId: string, messageId: string): Promise<{ messageId: string; seq: number; text: string }> {
    const history = await this.history(sessionId, events => events.some(event => assistantMessage(event)?.messageId === messageId))
    for (const event of history) {
      const assistant = assistantMessage(event)
      if (assistant?.messageId === messageId) return { ...assistant, seq: event.seq }
    }
    throw new Error('在父会话历史中找不到这条已完成的 Assistant 消息，请刷新页面后重新选择')
  }

  async archive(input: ArchiveSidecarInput): Promise<SidecarRecord> {
    this.requireChild(input.childSessionId)
    return this.registry.setArchived(input.childSessionId, input.archived)
  }

  requireChild(childSessionId: string): SidecarRecord {
    const record = this.registry.getByChild(childSessionId)
    if (record === undefined) throw new Error('child Session is not registered as a Sidecar')
    return record
  }

  async history(sessionId: string, stop?: (events: readonly HistoryEvent[]) => boolean): Promise<HistoryEvent[]> {
    let events: HistoryEvent[] = []
    let beforeSeq: number | undefined
    const seenBoundaries = new Set<number>()
    let page = 0
    while (true) {
      const payload = beforeSeq === undefined
        ? { sessionId: sessionId as SessionId, maxMessages: 100 }
        : { sessionId: sessionId as SessionId, beforeSeq, maxMessages: 100 }
      const value = unwrap(await this.api.sessions.history({ rpcId: stableRpcId('history', `${sessionId}:${beforeSeq ?? 'tail'}:${page}`), payload }))
      const pageEvents = value.events.map((entry: HistoryEntry) => entry.event as HistoryEvent)
      events = pageEvents.concat(events)
      if (stop?.(events) === true || !value.hasMore || pageEvents.length === 0) break
      const nextBoundary = minimumEventSeq(pageEvents)
      if (seenBoundaries.has(nextBoundary)) throw new Error('Sidecar history pagination repeated a boundary')
      seenBoundaries.add(nextBoundary)
      beforeSeq = nextBoundary
      page += 1
    }
    return events.sort((a, b) => a.seq - b.seq)
  }

  private async ensurePrompt(childSessionId: string, rpcId: string, text: string): Promise<void> {
    const key = `${childSessionId}:${rpcId}`
    const pending = this.promptFlights.get(key)
    if (pending !== undefined) {
      if (pending.text !== text) throw new Error('requestKey is already in flight with a different Sidecar prompt')
      return pending.task
    }
    const task = (async () => {
      const textHash = createHash('sha256').update(text).digest('hex')
      const known = this.registry.getPromptReceipt(childSessionId, rpcId)
      if (known?.textHash !== undefined && known.textHash !== textHash) {
        throw new Error('requestKey is already bound to a different Sidecar prompt')
      }
      if (known?.status === 'accepted') return

      const reservation = known === undefined
        ? await this.registry.reservePrompt(childSessionId, rpcId, textHash)
        : { created: false, receipt: known }

      // A fresh reservation is proof that this rpcId has never been admitted,
      // so the normal path goes straight to prompt(). History is consulted only
      // when recovering a receipt left pending by a crash or failed response.
      if (!reservation.created) {
        const history = await this.history(childSessionId, events => hasPromptRpcId(events, rpcId))
        const durable = history.find(event => event.type === 'user/message' && eventRpcId(event) === rpcId)
        if (durable !== undefined) {
          if (userMessageText(durable) !== text) throw new Error('requestKey is already bound to a different Sidecar prompt')
          await this.registry.acceptPrompt(childSessionId, rpcId, textHash)
          return
        }
      }

      unwrap(await this.api.sessions.prompt({
        rpcId: RpcId(rpcId),
        payload: { sessionId: childSessionId as SessionId, mode: 'queue', content: [{ type: 'text', text }] },
      }))
      await this.registry.acceptPrompt(childSessionId, rpcId, textHash)
    })().finally(() => { this.promptFlights.delete(key) })
    this.promptFlights.set(key, { text, task })
    return task
  }

  private async ensureHidden(childSessionId: string): Promise<void> {
    unwrap(await this.api.workspace.archiveSession({
      rpcId: stableRpcId('hide', childSessionId),
      payload: { sessionId: childSessionId as SessionId },
    }))
  }

  /**
   * Resume a cold Sidecar through ApiProxy's canonical Agent resolver.
   *
   * Calling ctx.agents.resume() here would skip the Host's persisted preset
   * composition. session.models is read-only, but deliberately resolves the
   * Agent first, so it restores the same tools/model setup as normal prompt
   * routing before the access controller reads or pins session policies.
   */
  private async ensureLoaded(childSessionId: string): Promise<void> {
    try {
      unwrap(await this.api.sessions.models({
        rpcId: stableRpcId('load', childSessionId),
        payload: { sessionId: childSessionId as SessionId },
      }))
    } catch (error: unknown) {
      throw new Error(`Sidecar Session ${childSessionId} 冷恢复失败：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
}

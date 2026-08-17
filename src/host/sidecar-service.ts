import { createHash } from 'node:crypto'
import type { ApiProxy, HistoryEntry, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { assistantMessage, hasPromptRpcId } from '../core/transcript.js'
import { normalizeQuestion, normalizeQuote, quoteTitle, textContainsQuote, wrapContextQuestion, wrapFirstQuestion, wrapSidecarQuestion } from '../core/quote.js'
import type { ArchiveSidecarInput, CreateSidecarInput, HistoryEvent, PromptSidecarInput, SidecarAccessMode, SidecarRecord } from '../core/types.js'
import type { SidecarAccessBoundary } from './access.js'
import { SidecarRegistry } from './registry.js'

function stableRpcId(kind: string, key: string): ReturnType<typeof RpcId> {
  return RpcId(`sidecar-${kind}-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`)
}

function unwrap<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
  return response.result.value
}

export class SidecarService {
  private readonly createFlights = new Map<string, Promise<SidecarRecord>>()
  private readonly promptFlights = new Map<string, Promise<void>>()

  constructor(
    private readonly api: ApiProxy,
    readonly registry: SidecarRegistry,
    private readonly access: SidecarAccessBoundary,
  ) {}

  async recoverRegistered(): Promise<void> {
    for (const record of this.registry.all()) {
      try {
        await this.ensureHidden(record.childSessionId)
        if (record.status === 'provisioning') await this.finishProvisioning(record)
        else if (record.access.mode === 'read-only') this.access.apply(record.childSessionId, 'read-only')
      }
      catch { /* A deleted legacy child must not prevent the plugin from booting. */ }
    }
  }

  list(parentSessionId: string, includeArchived = false): SidecarRecord[] {
    if (!parentSessionId) throw new Error('parentSessionId is required')
    return this.registry.list(parentSessionId, includeArchived)
  }

  async create(input: CreateSidecarInput): Promise<SidecarRecord> {
    const flightKey = `${input.parentSessionId}:${input.requestKey}`
    const pending = this.createFlights.get(flightKey)
    if (pending !== undefined) return pending
    const task = this.createInternal(input).finally(() => { this.createFlights.delete(flightKey) })
    this.createFlights.set(flightKey, task)
    return task
  }

  private async createInternal(input: CreateSidecarInput): Promise<SidecarRecord> {
    this.registry.ensureWritable()
    const parentSessionId = input.parentSessionId.trim()
    const requestKey = input.requestKey.trim()
    if (!parentSessionId || !requestKey || !input.sourceMessageId || !Number.isInteger(input.sourceSeq)) {
      throw new Error('parentSessionId, requestKey, sourceMessageId and integer sourceSeq are required')
    }
    if (input.sourceKind !== undefined && input.sourceKind !== 'selection' && input.sourceKind !== 'turn') {
      throw new Error('sourceKind must be selection or turn')
    }
    const accessMode: SidecarAccessMode = input.accessMode ?? 'inherit'
    if (accessMode !== 'read-only' && accessMode !== 'inherit') throw new Error('accessMode must be read-only or inherit')
    // Empty quotes are emitted only by whole-turn drafts. Inferring that mode keeps
    // the endpoint compatible with clients/boundaries that predate sourceKind.
    const sourceKind = input.sourceKind ?? (input.quote.trim() === '' ? 'turn' : 'selection')
    const quote = sourceKind === 'turn' ? '' : normalizeQuote(input.quote)
    const question = normalizeQuestion(input.question)
    const existing = this.registry.getByRequest(parentSessionId, requestKey)
    if (existing !== undefined) {
      if (existing.access.mode !== accessMode) throw new Error('requestKey is already bound to a different Sidecar access mode')
      if (existing.status === 'provisioning') return this.finishProvisioning(existing)
      await this.ensureHidden(existing.childSessionId)
      this.access.assert(existing)
      await this.ensurePrompt(existing.childSessionId, existing.firstPromptRpcId, wrapFirstQuestion(existing.quote, existing.firstQuestion, existing.sourceKind))
      return existing
    }

    const history = await this.history(parentSessionId)
    const source = history.find(event => event.seq === input.sourceSeq)
    const assistant = source === undefined ? undefined : assistantMessage(source)
    if (assistant === undefined || assistant.messageId !== input.sourceMessageId
      || (sourceKind === 'selection' && !textContainsQuote(assistant.text, quote))) {
      throw new Error('source message, seq and quote do not match a finalized Assistant message')
    }

    const forked = unwrap(await this.api.sessions.fork({
      rpcId: stableRpcId('fork', `${parentSessionId}:${requestKey}`),
      payload: { sessionId: parentSessionId as SessionId, atSeq: input.sourceSeq },
    }))
    const childSessionId = String(forked.sessionId)
    const title = quoteTitle(quote, sourceKind)
    const firstPromptRpcId = String(stableRpcId('first-prompt', `${parentSessionId}:${requestKey}`))
    const now = Date.now()
    const record: SidecarRecord = {
      parentSessionId,
      childSessionId,
      requestKey,
      sourceMessageId: input.sourceMessageId,
      sourceSeq: input.sourceSeq,
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
    const access = this.access.apply(record.childSessionId, record.access.mode)
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
    this.access.assert(record)
    const requestKey = input.requestKey.trim()
    if (!requestKey) throw new Error('requestKey is required')
    const question = normalizeQuestion(input.question)
    const rpcId = String(stableRpcId('prompt', `${record.childSessionId}:${requestKey}`))
    const source = input.source
    const text = source === undefined ? wrapSidecarQuestion(question) : () => this.contextPrompt(record, source, question)
    await this.ensurePrompt(record.childSessionId, rpcId, text)
    return { accepted: true, rpcId }
  }

  private async contextPrompt(record: SidecarRecord, source: NonNullable<PromptSidecarInput['source']>, question: string): Promise<string> {
    if (!source.sourceMessageId || !Number.isInteger(source.sourceSeq)
      || (source.sourceKind !== 'selection' && source.sourceKind !== 'turn')) {
      throw new Error('sourceMessageId, integer sourceSeq and sourceKind are required')
    }
    const history = await this.history(record.parentSessionId)
    const event = history.find(item => item.seq === source.sourceSeq)
    const assistant = event === undefined ? undefined : assistantMessage(event)
    if (assistant === undefined || assistant.messageId !== source.sourceMessageId) {
      throw new Error('source message, seq and quote do not match a finalized Assistant message')
    }
    const context = source.sourceKind === 'turn' ? assistant.text : normalizeQuote(source.quote)
    if (source.sourceKind === 'selection' && !textContainsQuote(assistant.text, context)) {
      throw new Error('source message, seq and quote do not match a finalized Assistant message')
    }
    return wrapContextQuestion(context, question, source.sourceKind)
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

  async history(sessionId: string): Promise<HistoryEvent[]> {
    const events: HistoryEvent[] = []
    let beforeSeq: number | undefined
    for (let page = 0; page < 100; page++) {
      const payload = beforeSeq === undefined
        ? { sessionId: sessionId as SessionId, maxMessages: 100 }
        : { sessionId: sessionId as SessionId, beforeSeq, maxMessages: 100 }
      const value = unwrap(await this.api.sessions.history({ rpcId: stableRpcId('history', `${sessionId}:${beforeSeq ?? 'tail'}:${page}`), payload }))
      const pageEvents = value.events.map((entry: HistoryEntry) => entry.event as HistoryEvent)
      events.unshift(...pageEvents)
      if (!value.hasMore || pageEvents.length === 0) break
      beforeSeq = Math.min(...pageEvents.map(event => event.seq))
    }
    return events.sort((a, b) => a.seq - b.seq)
  }

  private async ensurePrompt(childSessionId: string, rpcId: string, text: string | (() => Promise<string>)): Promise<void> {
    const key = `${childSessionId}:${rpcId}`
    const pending = this.promptFlights.get(key)
    if (pending !== undefined) return pending
    const task = (async () => {
      // Source verification and idempotency history are independent. Running
      // them together avoids adding two serial round trips before generation.
      const [history, resolvedText] = await Promise.all([
        this.history(childSessionId),
        typeof text === 'string' ? Promise.resolve(text) : text(),
      ])
      if (hasPromptRpcId(history, rpcId)) return
      unwrap(await this.api.sessions.prompt({
        rpcId: RpcId(rpcId),
        payload: { sessionId: childSessionId as SessionId, mode: 'queue', content: [{ type: 'text', text: resolvedText }] },
      }))
    })().finally(() => { this.promptFlights.delete(key) })
    this.promptFlights.set(key, task)
    return task
  }

  private async ensureHidden(childSessionId: string): Promise<void> {
    unwrap(await this.api.workspace.archiveSession({
      rpcId: stableRpcId('hide', childSessionId),
      payload: { sessionId: childSessionId as SessionId },
    }))
  }
}

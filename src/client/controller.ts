import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionFace, SessionId, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type { CreateSidecarInput, PromptSidecarInput, SidecarRecord } from '../core/types.js'
import { SidecarApi } from './api.js'
import { SidecarClientStore } from './store.js'
import { closestCandidate, type AssistantCandidate } from './selection.js'

export class SidecarController {
  readonly api = new SidecarApi()
  readonly store = new SidecarClientStore()
  private readonly loads = new Map<string, Promise<void>>()
  private readonly candidates = new Map<string, Map<string, AssistantCandidate>>()

  constructor(readonly connection: ConnectionHandle, private readonly sessions: SessionRuntime) {}

  async load(parentSessionId: string): Promise<void> {
    const pending = this.loads.get(parentSessionId)
    if (pending !== undefined) return pending
    this.store.setLoading(parentSessionId)
    const task = this.api.list(parentSessionId)
      .then(records => { this.store.setRecords(parentSessionId, records) })
      .catch(error => { this.store.setError(error) })
      .finally(() => { this.loads.delete(parentSessionId) })
    this.loads.set(parentSessionId, task)
    return task
  }

  async create(input: CreateSidecarInput): Promise<SidecarRecord> {
    const record = await this.api.create(input)
    await this.loadFresh(input.parentSessionId)
    this.store.clearDraft(input.parentSessionId)
    this.store.select(input.parentSessionId, record.childSessionId)
    return record
  }

  async prompt(input: PromptSidecarInput): Promise<void> {
    this.store.addOptimistic(input)
    try {
      const result = await this.api.prompt(input)
      this.store.ackOptimistic(input.childSessionId, input.requestKey, result.rpcId)
    } catch (error) {
      this.store.failOptimistic(input.childSessionId, input.requestKey, error)
      throw error
    }
  }

  async archive(parentSessionId: string, childSessionId: string, archived: boolean): Promise<void> {
    await this.api.archive({ childSessionId, archived })
    await this.loadFresh(parentSessionId)
  }

  face(childSessionId: string): SessionFace | undefined {
    return this.sessions.binding(childSessionId as SessionId)?.session
  }

  registerAssistant(parentSessionId: string, candidate: AssistantCandidate): () => void {
    const byMessage = this.candidates.get(parentSessionId) ?? new Map<string, AssistantCandidate>()
    byMessage.set(candidate.messageId, candidate)
    this.candidates.set(parentSessionId, byMessage)
    return () => {
      byMessage.delete(candidate.messageId)
      if (byMessage.size === 0) this.candidates.delete(parentSessionId)
    }
  }

  selectedAssistant(parentSessionId: string, quote: string, sourceRow: HTMLElement): AssistantCandidate | undefined {
    return closestCandidate([...(this.candidates.get(parentSessionId)?.values() ?? [])], quote, sourceRow)
  }

  private async loadFresh(parentSessionId: string): Promise<void> {
    this.loads.delete(parentSessionId)
    await this.load(parentSessionId)
  }
}

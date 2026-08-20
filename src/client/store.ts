import type { PromptSidecarInput, SidecarRecord } from '../core/types.js'

export interface SidecarClientSnapshot {
  sidebarAvailable: boolean
  recordsByParent: Record<string, SidecarRecord[]>
  loadingParents: Record<string, boolean>
  optimisticByChild: Record<string, OptimisticPrompt[]>
  error?: string
}

export interface OptimisticPrompt {
  requestKey: string
  question: string
  createdAt: number
  state: 'sending' | 'failed'
  rpcId?: string
  source?: PromptSidecarInput['source']
  error?: string
}

export class SidecarClientStore {
  private snapshot: SidecarClientSnapshot = { sidebarAvailable: false, recordsByParent: {}, loadingParents: {}, optimisticByChild: {} }
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): SidecarClientSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  records(parentSessionId: string): SidecarRecord[] { return this.snapshot.recordsByParent[parentSessionId] ?? [] }

  setSidebarAvailable(available: boolean): void {
    if (this.snapshot.sidebarAvailable === available) return
    this.snapshot = { ...this.snapshot, sidebarAvailable: available }
    this.emit()
  }

  setRecords(parentSessionId: string, records: SidecarRecord[]): void {
    const { error: _error, ...withoutError } = this.snapshot
    this.snapshot = {
      ...withoutError,
      recordsByParent: { ...this.snapshot.recordsByParent, [parentSessionId]: records.map(normalizeRecord) },
      loadingParents: { ...this.snapshot.loadingParents, [parentSessionId]: false },
    }
    this.emit()
  }

  setLoading(parentSessionId: string): void {
    const { error: _error, ...withoutError } = this.snapshot
    this.snapshot = { ...withoutError, loadingParents: { ...this.snapshot.loadingParents, [parentSessionId]: true } }
    this.emit()
  }

  setLoadError(parentSessionId: string, error: unknown): void {
    this.snapshot = {
      ...this.snapshot,
      loadingParents: { ...this.snapshot.loadingParents, [parentSessionId]: false },
      error: error instanceof Error ? error.message : String(error),
    }
    this.emit()
  }

  setError(error: unknown): void {
    this.snapshot = { ...this.snapshot, error: error instanceof Error ? error.message : String(error) }
    this.emit()
  }

  addOptimistic(input: PromptSidecarInput): void {
    const current = this.snapshot.optimisticByChild[input.childSessionId] ?? []
    const existing = current.find(item => item.requestKey === input.requestKey)
    const next: OptimisticPrompt = {
      requestKey: input.requestKey,
      question: input.question,
      createdAt: existing?.createdAt ?? Date.now(),
      state: 'sending',
      ...(input.source === undefined ? {} : { source: input.source }),
    }
    this.setOptimistic(input.childSessionId, [...current.filter(item => item.requestKey !== input.requestKey), next])
  }

  ackOptimistic(childSessionId: string, requestKey: string, rpcId: string): void {
    this.changeOptimistic(childSessionId, requestKey, item => ({ ...item, state: 'sending', rpcId }))
  }

  failOptimistic(childSessionId: string, requestKey: string, error: unknown): void {
    this.changeOptimistic(childSessionId, requestKey, item => ({
      ...item, state: 'failed', error: error instanceof Error ? error.message : String(error),
    }))
  }

  resolveOptimistic(childSessionId: string, deliveredRpcIds: ReadonlySet<string>): void {
    const current = this.snapshot.optimisticByChild[childSessionId] ?? []
    const next = current.filter(item => item.rpcId === undefined || !deliveredRpcIds.has(item.rpcId))
    if (next.length !== current.length) this.setOptimistic(childSessionId, next)
  }

  private changeOptimistic(childSessionId: string, requestKey: string, update: (item: OptimisticPrompt) => OptimisticPrompt): void {
    const current = this.snapshot.optimisticByChild[childSessionId] ?? []
    this.setOptimistic(childSessionId, current.map(item => item.requestKey === requestKey ? update(item) : item))
  }

  private setOptimistic(childSessionId: string, optimistic: OptimisticPrompt[]): void {
    this.snapshot = { ...this.snapshot, optimisticByChild: { ...this.snapshot.optimisticByChild, [childSessionId]: optimistic } }
    this.emit()
  }

  private emit(): void { for (const listener of this.listeners) listener() }
}

function normalizeRecord(record: SidecarRecord): SidecarRecord {
  if (record.sourceKind === 'selection' || record.sourceKind === 'turn') return record
  return { ...record, sourceKind: record.quote.trim() === '' ? 'turn' : 'selection' }
}

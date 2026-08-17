import { SIDECAR_UI_STORAGE_KEY, type PromptSidecarInput, type SidecarDraft, type SidecarParentUiState, type SidecarRecord, type SidecarUiState } from '../core/types.js'

const DEFAULT_WIDTH = 520

function safeLoad(): SidecarUiState {
  try {
    const value = JSON.parse(localStorage.getItem(SIDECAR_UI_STORAGE_KEY) ?? '{}') as Partial<SidecarUiState>
    const byParent = typeof value.byParent === 'object' && value.byParent !== null ? value.byParent : {}
    for (const parent of Object.values(byParent)) {
      if (parent.draft !== undefined && parent.draft.sourceKind === undefined) parent.draft.sourceKind = 'selection'
      if (parent.draft !== undefined && parent.draft.accessMode === undefined) parent.draft.accessMode = 'read-only'
      if (parent.draft !== undefined && parent.draft.forceNew === undefined) parent.draft.forceNew = true
    }
    return { byParent }
  } catch { return { byParent: {} } }
}

export interface SidecarClientSnapshot {
  ui: SidecarUiState
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
  private snapshot: SidecarClientSnapshot = { ui: safeLoad(), recordsByParent: {}, loadingParents: {}, optimisticByChild: {} }
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): SidecarClientSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  parent(parentSessionId: string): SidecarParentUiState {
    return this.snapshot.ui.byParent[parentSessionId] ?? { open: false, width: DEFAULT_WIDTH }
  }

  records(parentSessionId: string): SidecarRecord[] { return this.snapshot.recordsByParent[parentSessionId] ?? [] }

  setRecords(parentSessionId: string, records: SidecarRecord[]): void {
    const parent = this.parent(parentSessionId)
    const activeExists = records.some(item => item.childSessionId === parent.activeChildSessionId)
    const nextParent = { ...parent, ...(activeExists ? {} : records[0] === undefined ? {} : { activeChildSessionId: records[0].childSessionId }) }
    const { error: _error, ...withoutError } = this.snapshot
    this.snapshot = {
      ...withoutError,
      recordsByParent: { ...this.snapshot.recordsByParent, [parentSessionId]: records },
      loadingParents: { ...this.snapshot.loadingParents, [parentSessionId]: false },
      ui: { byParent: { ...this.snapshot.ui.byParent, [parentSessionId]: nextParent } },
    }
    this.persistAndEmit()
  }

  setLoading(parentSessionId: string): void {
    this.snapshot = { ...this.snapshot, loadingParents: { ...this.snapshot.loadingParents, [parentSessionId]: true } }
    this.emit()
  }

  setError(error: unknown): void {
    this.snapshot = { ...this.snapshot, error: error instanceof Error ? error.message : String(error) }
    this.emit()
  }

  openDraft(parentSessionId: string, draft: SidecarDraft): void {
    // A fresh entry from the parent conversation must expose the access-mode
    // choice directly. Reusing an existing Sidecar is an explicit opt-in.
    this.updateParent(parentSessionId, current => ({
      ...current,
      open: true,
      draft: { ...draft, forceNew: draft.forceNew ?? true },
    }))
  }

  updateDraftQuestion(parentSessionId: string, question: string): void {
    this.updateParent(parentSessionId, current => current.draft === undefined ? current : ({ ...current, draft: { ...current.draft, question } }))
  }

  setDraftForceNew(parentSessionId: string, forceNew: boolean): void {
    this.updateParent(parentSessionId, current => current.draft === undefined ? current : ({
      ...current, draft: { ...current.draft, forceNew },
    }))
  }

  setDraftAccessMode(parentSessionId: string, accessMode: SidecarDraft['accessMode']): void {
    this.updateParent(parentSessionId, current => current.draft === undefined ? current : ({
      ...current, draft: { ...current.draft, accessMode },
    }))
  }

  clearDraft(parentSessionId: string): void {
    this.updateParent(parentSessionId, ({ draft: _draft, ...current }) => current)
  }

  useWholeTurnDraft(parentSessionId: string): void {
    this.updateParent(parentSessionId, current => current.draft === undefined ? current : ({
      ...current,
      draft: { ...current.draft, sourceKind: 'turn', quote: '' },
    }))
  }

  select(parentSessionId: string, childSessionId: string): void {
    this.updateParent(parentSessionId, ({ draft: _draft, ...current }) => ({
      ...current, activeChildSessionId: childSessionId, open: true,
    }))
  }

  close(parentSessionId: string): void { this.updateParent(parentSessionId, current => ({ ...current, open: false })) }

  resize(parentSessionId: string, width: number): void {
    this.updateParent(parentSessionId, current => ({ ...current, width: Math.min(720, Math.max(400, Math.round(width))) }))
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

  private updateParent(parentSessionId: string, update: (current: SidecarParentUiState) => SidecarParentUiState): void {
    this.snapshot = { ...this.snapshot, ui: { byParent: { ...this.snapshot.ui.byParent, [parentSessionId]: update(this.parent(parentSessionId)) } } }
    this.persistAndEmit()
  }

  private persistAndEmit(): void {
    try { localStorage.setItem(SIDECAR_UI_STORAGE_KEY, JSON.stringify(this.snapshot.ui)) } catch { /* private mode */ }
    this.emit()
  }

  private emit(): void { for (const listener of this.listeners) listener() }
}

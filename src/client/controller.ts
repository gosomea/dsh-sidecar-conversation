import type { SidecarReference } from '../core/references.js'
import { questionTitle } from '../core/quote.js'
import type { CreateSidecarInput, PromptSidecarInput, SidecarDraft, SidecarRecord } from '../core/types.js'
import { SidecarApi } from './api.js'
import { SidecarClientStore } from './store.js'
import { closestCandidate, type AssistantCandidate } from './selection.js'
import {
  betterSidebarTabState,
  closeSidecar,
  openSidecarActive,
  openSidecarDraft,
  openSidecarHistory,
  type BetterSidebarService,
} from './better-sidebar.js'
import { draftSidecarTabMeta, sidecarTabId, sidecarTabPath } from './tab-meta.js'
import { migrateLegacySidecarTabs } from './legacy-migration.js'

export class SidecarController {
  selectionFromNavigation = false
  recentTarget: ((parent: string) => { id: string; title: string } | undefined) | undefined
  private targetRevision = 0
  private readonly targetListeners = new Set<() => void>()
  subscribeTargets = (fn: () => void): (() => void) => { this.targetListeners.add(fn); return () => { this.targetListeners.delete(fn) } }
  getTargetRevision = (): number => this.targetRevision
  targetsChanged(): void { this.targetRevision++; for (const fn of this.targetListeners) fn() }
  turnNavigator: ((parent: string, turn: { turn: number; seq: number }) => Promise<void>) | undefined
  jumpToTurn(parent: string, turn: { turn: number; seq: number }): void {
    this.store.clearError()
    this.selectionFromNavigation = true
    if (this.turnNavigator) void this.turnNavigator(parent, turn).catch(error => this.store.setError(error))
  }
  referenceTarget: ((parent: string, draft: SidecarDraft, targetId?: string) => Promise<void>) | undefined
  mainReferenceTarget: ((reference: SidecarReference) => Promise<void>) | undefined
  addToMain(parent: string, draft: SidecarDraft): void {
    this.store.clearError()
    const reference: SidecarReference = { parentSessionId: parent, sourceMessageId: draft.sourceMessageId,
      sourceSeq: draft.sourceSeq, sourceKind: draft.sourceKind, quote: draft.quote,
      ...(draft.sourceOffset === undefined ? {} : { textOffset: draft.sourceOffset }) }
    if (this.mainReferenceTarget) void this.mainReferenceTarget(reference).catch(error => this.store.setError(error))
  }
  referenceNavigator: ((reference: SidecarReference) => Promise<void>) | undefined
  addSource(parent: string, draft: SidecarDraft, targetId?: string): void {
    this.store.clearError()
    if (this.referenceTarget) void this.referenceTarget(parent, draft, targetId).catch(error => this.store.setError(error))
    else this.openDraft(parent, draft)
  }
  jumpToSource(reference: SidecarReference): void {
    this.store.clearError()
    this.selectionFromNavigation = true
    if (this.referenceNavigator) void this.referenceNavigator(reference).catch(error => this.store.setError(error))
  }
  readonly api = new SidecarApi()
  readonly store = new SidecarClientStore()
  private readonly loads = new Map<string, Promise<void>>()
  private readonly candidates = new Map<string, Map<string, AssistantCandidate>>()
  private readonly migratedLegacyIds = new Set<string>()
  private sidebar: BetterSidebarService | undefined

  async load(parentSessionId: string): Promise<void> {
    const pending = this.loads.get(parentSessionId)
    if (pending !== undefined) return pending
    this.store.setLoading(parentSessionId)
    const task = this.api.list(parentSessionId, true)
      .then(records => {
        this.store.setRecords(parentSessionId, records)
        this.migrateLegacyTabs()
      })
      .catch(error => { this.store.setLoadError(parentSessionId, error) })
      .finally(() => { this.loads.delete(parentSessionId) })
    this.loads.set(parentSessionId, task)
    return task
  }

  async prepare(parentSessionId: string, requestKey: string, draft: SidecarDraft): Promise<void> {
    const record = await this.api.prepare({ parentSessionId, requestKey, sourceMessageId: draft.sourceMessageId,
      sourceSeq: draft.sourceSeq, sourceKind: draft.sourceKind, creationMode: draft.creationMode ?? 'fork', quote: draft.quote, question: '', accessMode: draft.accessMode })
    await this.load(parentSessionId)
    this.requireSidebar().updateTab(sidecarTabId(requestKey), {
      title: record.title, path: sidecarTabPath(requestKey),
      meta: { version: 1, kind: 'active', parentSessionId, requestKey, childSessionId: record.childSessionId, initialDraft: draft },
    })
    this.store.setRecords(parentSessionId, [...this.store.records(parentSessionId).filter(r => r.childSessionId !== record.childSessionId), record])
  }

  async create(input: CreateSidecarInput): Promise<SidecarRecord> {
    const record = await this.api.create(input)
    await this.loadFresh(input.parentSessionId)
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

  openDraft(parentSessionId: string, draft: SidecarDraft): void {
    const service = this.requireSidebar()
    const requestKey = draft.requestKey ?? `sidecar-create-${globalThis.crypto.randomUUID()}`
    openSidecarDraft(service, {
      parentSessionId,
      requestKey,
      draft: { ...draft, references: draft.references ?? [{ parentSessionId, sourceMessageId: draft.sourceMessageId, sourceSeq: draft.sourceSeq, sourceKind: draft.sourceKind, quote: draft.quote, ...(draft.sourceOffset === undefined ? {} : { textOffset: draft.sourceOffset }) }], requestKey, forceNew: true },
      title: draft.sourceKind === 'turn' ? '侧问 · 整个回合' : `侧问 · ${summary(draft.quote)}`,
    })
  }

  updateDraft(parentSessionId: string, requestKey: string, draft: SidecarDraft): void {
    const service = this.requireSidebar()
    service.updateTab(sidecarTabId(requestKey), {
      title: draft.question.trim() ? questionTitle(draft.question) : '新侧问',
      path: sidecarTabPath(requestKey),
      meta: draftSidecarTabMeta(parentSessionId, requestKey, { ...draft, requestKey, forceNew: true }),
    })
  }

  activateTab(record: SidecarRecord): void {
    const service = this.requireSidebar()
    service.updateTab(sidecarTabId(record.requestKey), {
      title: record.title,
      path: sidecarTabPath(record.requestKey),
      meta: {
        version: 1,
        kind: 'active',
        parentSessionId: record.parentSessionId,
        requestKey: record.requestKey,
        childSessionId: record.childSessionId,
      },
    })
    service.activateTab(sidecarTabId(record.requestKey), { sessionId: record.parentSessionId })
  }

  openRecord(record: SidecarRecord): void {
    openSidecarActive(this.requireSidebar(), { record, title: record.title })
  }

  async newFromHistory(parentSessionId: string): Promise<void> {
    const source = await this.api.latestSource(parentSessionId)
    this.openDraft(parentSessionId, { ...source, sourceKind: 'turn', quote: '', question: '', accessMode: 'read-only', references: [] })
  }

  openHistory(parentSessionId: string): void {
    openSidecarHistory(this.requireSidebar(), parentSessionId)
  }

  closeTab(parentSessionId: string, requestKey: string): void {
    closeSidecar(this.requireSidebar(), parentSessionId, requestKey)
  }

  bindSidebar(service: BetterSidebarService): () => void {
    this.sidebar = service
    this.store.setSidebarAvailable(true)
    return () => {
      if (this.sidebar === service) {
        this.sidebar = undefined
        this.store.setSidebarAvailable(false)
      }
    }
  }

  migrateLegacyTabs(available?: BetterSidebarService): void {
    const service = available ?? this.sidebar
    if (service === undefined) return
    const before = betterSidebarTabState(service.getSnapshot())
    const seeds = migrateLegacySidecarTabs({ records: this.store.getSnapshot().recordsByParent })
    for (const seed of seeds) {
      if (this.migratedLegacyIds.has(seed.id)) continue
      if (before.openTabIds.has(seed.id)) {
        this.migratedLegacyIds.add(seed.id)
        continue
      }
      if (service.restoreTab) service.restoreTab(seed, { sessionId: seed.meta.parentSessionId })
      else service.openTab(seed, { sessionId: seed.meta.parentSessionId })
      this.migratedLegacyIds.add(seed.id)
    }
    // Opening a migrated seed focuses it by design. Migration is background
    // compatibility work, so it must never steal a newly-created Sidecar (or
    // any other tab) that the user selected while registry loading finished.
    if (!service.restoreTab && before.sessionId !== undefined && before.activeTabId !== undefined) {
      service.activateTab(before.activeTabId, { sessionId: before.sessionId })
    }
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

  selectedSource(quote: string, sourceRow: HTMLElement): { parentSessionId: string; candidate: AssistantCandidate } | undefined {
    const surface = sourceRow.closest<HTMLElement>('[data-conversation-session]')
    if (surface?.closest('[data-sidecar-native-surface]')) return undefined
    const markers = [...(surface ?? document).querySelectorAll<HTMLElement>('[data-sidecar-assistant-marker]')]
      .filter(marker => !marker.closest('[data-sidecar-native-surface]') && (sourceRow.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING))
    const marker = markers[0]
    const parentSessionId = marker?.dataset.sidecarSessionId
    const messageId = marker?.dataset.sidecarMessageId
    const sourceSeq = Number(marker?.dataset.sidecarSourceSeq)
    if (!marker || !parentSessionId || !messageId || !Number.isSafeInteger(sourceSeq)) return undefined
    if (surface && surface.dataset.conversationSession !== parentSessionId) return undefined
    if (!sourceRow.innerText.replace(/\s+/g, ' ').includes(quote.replace(/\s+/g, ' '))) return undefined
    return { parentSessionId, candidate: { marker, messageId, sourceSeq, text: sourceRow.innerText } }

  }

  selectedAssistant(parentSessionId: string, quote: string, sourceRow: HTMLElement): AssistantCandidate | undefined {
    return closestCandidate([...(this.candidates.get(parentSessionId)?.values() ?? [])], quote, sourceRow)
  }

  private async loadFresh(parentSessionId: string): Promise<void> {
    this.loads.delete(parentSessionId)
    await this.load(parentSessionId)
  }

  private requireSidebar(): BetterSidebarService {
    const service = this.sidebar
    if (service === undefined) {
      const error = new Error('侧问需要 DSH 原生右侧栏')
      this.store.setError(error)
      throw error
    }
    return service
  }
}

function summary(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return '选中内容'
  return compact.length > 24 ? `${compact.slice(0, 24)}…` : compact
}

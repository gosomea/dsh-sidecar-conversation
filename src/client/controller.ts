import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionFace, SessionId, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type { CreateSidecarInput, PromptSidecarInput, SidecarDraft, SidecarRecord } from '../core/types.js'
import { unwrapSidecarQuestion } from '../core/quote.js'
import { SidecarApi } from './api.js'
import { SidecarClientStore, type OptimisticPrompt } from './store.js'
import { assistantSourceForRow, closestCandidate, type AssistantCandidate } from './selection.js'
import { textContainsQuote } from '../core/quote.js'
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

export interface NativeConversationService {
  mountSurface(target: {
    sessionId: SessionId
    afterSeq: number
    container: HTMLElement
    header?: boolean
    composer?: boolean
    transformUserText?: (text: string) => string
    hiddenContextPlugins?: readonly string[]
    input?: {
      submit: (text: string) => Promise<void> | void
      cancel?: () => Promise<void> | void
      textOnly?: boolean
      placeholder?: string
    }
    pendingUserMessages?: readonly { id: string; text: string }[]
  }): NativeConversationSurfaceHandle
}

export interface NativeConversationSurfaceHandle {
  update(patch: {
    pendingUserMessages?: readonly { id: string; text: string }[]
  }): void
  dispose(): void
}

interface DetachedSessionLease {
  readonly binding: { readonly session: SessionFace }
  readonly ready: Promise<void>
  dispose(): void
}

interface EmbeddedSessionRuntime extends SessionRuntime {
  acquireDetached?: (id: SessionId) => DetachedSessionLease
}

export class SidecarController {
  readonly api = new SidecarApi()
  readonly store = new SidecarClientStore()
  private readonly loads = new Map<string, Promise<void>>()
  private readonly candidates = new Map<string, Map<string, AssistantCandidate>>()
  private readonly migratedLegacyIds = new Set<string>()
  private sidebar: BetterSidebarService | undefined

  constructor(
    readonly connection: ConnectionHandle,
    private readonly sessions: SessionRuntime,
    private readonly resolveNativeConversation: () => NativeConversationService | undefined,
    private readonly resolveSidebar: () => BetterSidebarService | undefined = () => undefined,
  ) {}

  async mountNativeSurface(record: SidecarRecord, container: HTMLElement): Promise<() => void> {
    const acquireDetached = (this.sessions as EmbeddedSessionRuntime).acquireDetached
    const conversation = this.resolveNativeConversation()
    if (conversation === undefined) throw new Error('当前 Harness 未提供 Conversation Surface，请更新并重启 Harness')
    if (acquireDetached === undefined) throw new Error('当前 Harness 未提供 detached Session，请更新并重启 Harness')

    // Retaining a child does not select it as the current Session, so Sidecar
    // tabs never leak into primary navigation. The binding exists
    // synchronously; history completion is rendered by the native Surface's
    // own loading state instead of blocking the panel mount.
    const lease = acquireDetached.call(this.sessions, record.childSessionId as SessionId)
    const delivered = deliveredPromptRpcIds(lease.binding.session)
    this.store.resolveOptimistic(record.childSessionId, delivered)
    let surface: NativeConversationSurfaceHandle
    try {
      surface = conversation.mountSurface({
        sessionId: record.childSessionId as SessionId,
        // The child is forked exactly at sourceSeq. Rendering only later events
        // hides inherited parent history without polling for a first-prompt
        // boundary that may not be durable yet.
        afterSeq: record.sourceSeq,
        container,
        header: false,
        composer: true,
        transformUserText: text => unwrapSidecarQuestion(text).question,
        hiddenContextPlugins: ['@deepseek-ai/dsh-system-prompt'],
        input: {
          submit: async text => {
            await this.prompt({
              childSessionId: record.childSessionId,
              requestKey: `sidecar-prompt-${globalThis.crypto.randomUUID()}`,
              question: text,
            })
          },
          cancel: async () => {
            const result = await lease.binding.session.cancel()
            if (!result.ok) throw new Error(result.error.message)
          },
          textOnly: true,
          placeholder: '继续在侧边提问…',
        },
        pendingUserMessages: pendingSurfaceMessages(
          this.store.getSnapshot().optimisticByChild[record.childSessionId] ?? [],
          delivered,
        ),
      })
    } catch (error) {
      lease.dispose()
      throw error
    }

    let live = true
    let syncing = false
    const syncPending = (): void => {
      if (!live || syncing) return
      syncing = true
      try {
        const currentDelivered = deliveredPromptRpcIds(lease.binding.session)
        this.store.resolveOptimistic(record.childSessionId, currentDelivered)
        surface.update({
          pendingUserMessages: pendingSurfaceMessages(
            this.store.getSnapshot().optimisticByChild[record.childSessionId] ?? [],
            currentDelivered,
          ),
        })
      } finally {
        syncing = false
      }
    }
    const unsubscribeStore = this.store.subscribe(syncPending)
    const unsubscribeSession = lease.binding.session.subscribe(syncPending)
    syncPending()

    return () => {
      if (!live) return
      live = false
      unsubscribeStore()
      unsubscribeSession()
      surface.dispose()
      lease.dispose()
    }
  }

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
      draft: { ...draft, requestKey, forceNew: true },
      title: draft.sourceKind === 'turn' ? '侧问 · 整个回合' : `侧问 · ${summary(draft.quote)}`,
    })
  }

  updateDraft(parentSessionId: string, requestKey: string, draft: SidecarDraft): void {
    const service = this.requireSidebar()
    service.updateTab(sidecarTabId(requestKey), {
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
  }

  openRecord(record: SidecarRecord): void {
    openSidecarActive(this.requireSidebar(), { record, title: record.title })
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
    const service = available ?? this.sidebar ?? this.resolveSidebar()
    if (service === undefined) return
    const before = betterSidebarTabState(service.getSnapshot())
    const seeds = migrateLegacySidecarTabs({ records: this.store.getSnapshot().recordsByParent })
    for (const seed of seeds) {
      if (this.migratedLegacyIds.has(seed.id)) continue
      if (before.openTabIds.has(seed.id)) {
        this.migratedLegacyIds.add(seed.id)
        continue
      }
      service.openTab(seed, { sessionId: seed.meta.parentSessionId })
      this.migratedLegacyIds.add(seed.id)
    }
    // Opening a migrated seed focuses it by design. Migration is background
    // compatibility work, so it must never steal a newly-created Sidecar (or
    // any other tab) that the user selected while registry loading finished.
    if (before.sessionId !== undefined && before.activeTabId !== undefined) {
      service.activateTab(before.activeTabId, { sessionId: before.sessionId })
    }
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
    const parentSnapshot = this.face(parentSessionId)?.getSnapshot()
    if (parentSnapshot !== undefined) {
      const exact = assistantSourceForRow(parentSnapshot, sourceRow)
      if (exact !== undefined && textContainsQuote(exact.text, quote)) return { ...exact, marker: sourceRow }
    }
    // Compatibility fallback for Harness builds predating stable chat flow
    // keys. Candidate text must still contain the quote, so proximity can no
    // longer bind an older row to an unrelated later Assistant message.
    return closestCandidate([...(this.candidates.get(parentSessionId)?.values() ?? [])], quote, sourceRow)
  }

  private async loadFresh(parentSessionId: string): Promise<void> {
    this.loads.delete(parentSessionId)
    await this.load(parentSessionId)
  }

  private requireSidebar(): BetterSidebarService {
    const service = this.sidebar ?? this.resolveSidebar()
    if (service === undefined) {
      const error = new Error('侧问需要 dsh-better-sidebar 0.14 或更高版本')
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

function deliveredPromptRpcIds(session: SessionFace): Set<string> {
  const delivered = new Set<string>()
  // Message sources are intentionally extensible on the wire. Sidecar only
  // reads the stable user-source rpcId and never walks nested payloads, which
  // also avoids the recursive scans that caused earlier stack overflows.
  for (const node of session.getSnapshot().nodes) {
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    const source = node.source
    if (typeof source !== 'object' || source === null) continue
    const rpcId = (source as { rpcId?: unknown }).rpcId
    if (typeof rpcId === 'string' && rpcId !== '') delivered.add(rpcId)
  }
  return delivered
}

function pendingSurfaceMessages(
  optimistic: readonly OptimisticPrompt[],
  delivered: ReadonlySet<string>,
): readonly { id: string; text: string }[] {
  return optimistic
    .filter(item => item.state === 'sending' && (item.rpcId === undefined || !delivered.has(item.rpcId)))
    .map(item => ({ id: item.requestKey, text: item.question }))
}

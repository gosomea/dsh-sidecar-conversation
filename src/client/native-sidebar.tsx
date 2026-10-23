import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import { ForkContext, forkProgress } from './components/ForkContext.js'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SOURCE, registerReferences } from './references.js'
import { referenceLabel } from '../core/references.js'
import { questionTitle } from '../core/quote.js'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionProviderComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime, PropsRenderSlots, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BetterSidebarService, BetterSidebarTab, BetterSidebarOpenTabSeed } from './better-sidebar.js'
import { SidecarChatTab, SidecarHistoryTab } from './components/SidecarTabs.js'
import type { SidecarController } from './controller.js'
import { parseSidecarTabMeta, SIDECAR_CHAT_TAB_TYPE, SIDECAR_HISTORY_TAB_TYPE } from './tab-meta.js'

declare module '@deepseek-ai/dsh-api-session-controller/client' { interface SessionReferenceSourceMap { sidecarView: unknown } }

const PREFIX = 'dsh-resource://sidecar/'
const STORAGE = 'dsh-sidecar-native-tabs-v1'
type SavedTab = BetterSidebarTab & { sessionId: string; usedAt?: number }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidecar.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Adapts the plugin's tab lifecycle to DSH's session-owned native dock. */
export function registerNativeSidebar(ctx: Context, controller: SidecarController): () => void {
  let saved: Record<string, SavedTab> = {}
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) saved = value as Record<string, SavedTab>
  } catch { /* Durable history remains available if local drafts are corrupt. */ }
  const initializedDrafts = new Set<string>()
  const referenceInputs = new Map<string, InputActions>()
  const inputWaiters = new Set<() => void>()
  const waitInput = async (child: string): Promise<InputActions> => {
    const present = referenceInputs.get(child)
    if (present) return present
    return new Promise((resolve, reject) => {
      const check = () => { const value = referenceInputs.get(child); if (value) { clearTimeout(timer); inputWaiters.delete(check); resolve(value) } }
      const timer = setTimeout(() => { inputWaiters.delete(check); reject(new Error('侧问输入框尚未就绪，请重试')) }, 10000)
      inputWaiters.add(check)
      check()
    })
  }
  const listeners = new Set<() => void>()
  let revision = 0
  const changed = () => {
    revision++
    try { localStorage.setItem(STORAGE, JSON.stringify(saved)) } catch { controller.store.setError(new Error('无法保存本地侧问标签；已发送的对话仍保存在侧问历史中')) }
    controller.targetsChanged()
    for (const fn of listeners) fn()
  }
  const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
  const address = (id: string) => PREFIX + encodeURIComponent(id)
  const open = (seed: BetterSidebarOpenTabSeed, scope: { sessionId: string }) => {
    const id = seed.id ?? seed.type
    saved[id] = { ...saved[id], ...seed, id, title: seed.title ?? saved[id]?.title ?? '侧问', sessionId: scope.sessionId, usedAt: Date.now() }
    changed()
    if (seed.type === SIDECAR_HISTORY_TAB_TYPE) ctx.sidebarRight.openTabIn(scope.sessionId as SessionId, SIDECAR_HISTORY_TAB_TYPE)
    else ctx.sidebarRight.openResourceIn(scope.sessionId as SessionId, address(id), { kind: SIDECAR_CHAT_TAB_TYPE })
  }
  const service: BetterSidebarService = {
    registerTab: () => () => {},
    openTab: open,
    restoreTab: (seed, scope) => {
      const id = seed.id ?? seed.type
      if (saved[id]) return
      saved[id] = { ...seed, id, title: seed.title ?? '侧问', sessionId: scope.sessionId }
      changed()
    },
    activateTab: (id, scope) => { const tab = saved[id]; if (tab !== undefined) open(tab, scope) },
    updateTab: (id, patch) => { if (saved[id] !== undefined) { saved[id] = { ...saved[id], ...patch }; changed() } },
    closeTab: (id, scope) => {
      for (const tab of ctx.sidebarRight.tabsIn(scope.sessionId as SessionId)) {
        if (tab.contentId === address(id)) ctx.sidebarRight.closeIn(scope.sessionId as SessionId, tab.id)
      }
    },
    getSnapshot: () => ({ sessionId: ctx.sidebarRight.mounted.getSnapshot(), state: undefined }),
    subscribeState: subscribe,
  }
  const disposeBinding = controller.bindSidebar(service)
  const availableTargets = (parent: string) => {
    const openAddresses = new Set(ctx.sidebarRight.tabsIn(parent as SessionId).map(tab => tab.contentId))
    return Object.values(saved)
      .filter(tab => tab.sessionId === parent && tab.type === SIDECAR_CHAT_TAB_TYPE && openAddresses.has(address(tab.id)))
      .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))
      .filter(tab => {
        const meta = parseSidecarTabMeta(tab.meta)
        return meta?.kind === 'active' && meta.parentSessionId === parent
          && controller.store.records(parent).some(r => r.requestKey === meta.requestKey && r.childSessionId === meta.childSessionId && r.status === 'active')
      })
  }
  controller.recentTarget = parent => {
    const target = availableTargets(parent)[0]
    if (!target) return undefined
    const meta = parseSidecarTabMeta(target.meta)!
    const record = controller.store.records(parent).find(r => r.requestKey === meta.requestKey)
    const title = meta.kind === 'draft' ? (meta.draft.question.trim() ? questionTitle(meta.draft.question) : '新侧问') : (record?.title ?? target.title)
    return { id: target.id, title: title.replace(/^↳\s*侧问\s*·\s*/, '') }
  }
  controller.referenceTarget = async (parent, draft, targetId) => {
    const reference = { parentSessionId: parent, sourceMessageId: draft.sourceMessageId, sourceSeq: draft.sourceSeq, sourceKind: draft.sourceKind, quote: draft.quote, ...(draft.sourceOffset === undefined ? {} : { textOffset: draft.sourceOffset }) }
    if (controller.store.getSnapshot().recordsByParent[parent] === undefined) await controller.load(parent)
    const candidates = availableTargets(parent)
    const target = targetId === undefined ? candidates[0] : candidates.find(t => t.id === targetId)
    if (!target) {
      if (targetId !== undefined) throw new Error('目标侧问已不可用，请重新选择或从此回合新建侧问')
      controller.openDraft(parent, draft); return
    }
    const meta = parseSidecarTabMeta(target.meta)!
    if (meta.kind === 'draft') {
      controller.updateDraft(parent, meta.requestKey, { ...meta.draft, references: [...(meta.draft.references ?? [{ parentSessionId: parent, sourceMessageId: meta.draft.sourceMessageId, sourceSeq: meta.draft.sourceSeq, sourceKind: meta.draft.sourceKind, quote: meta.draft.quote }]), reference] })
      open(saved[target.id]!, { sessionId: parent })
    } else {
      open(target, { sessionId: parent })
      await ctx.sessions.using(meta.childSessionId as SessionId, { source: 'sidecarView' }, async ref => {
        const binding = await ref.ready
        const input = ctx.conversation.input.for(binding.ctx)
        const actions = await waitInput(meta.childSessionId)
        const span = actions.captureInsertion()
        if (!input.insertReference({ source: SOURCE, ref: JSON.stringify(reference), label: referenceLabel(reference), appearance: 'session', clipboardText: referenceLabel(reference) },
          { ...span, start: span.end })) throw new Error('侧问输入框正忙，引用未添加，请重试')
        actions.persistDraft()
        input.focus()
      })
    }
  }
  const disposers = [disposeBinding, ctx.sidebarRight.openTabs?.subscribe(() => controller.targetsChanged()) ?? (() => {}), registerReferences(ctx, controller), () => { controller.referenceTarget = undefined; controller.recentTarget = undefined }]
  disposers.push(ctx.sidebarRightTabs.register({
    id: SIDECAR_CHAT_TAB_TYPE, kind: SIDECAR_CHAT_TAB_TYPE, title: value => saved[decodeURIComponent(value.slice(PREFIX.length))]?.title ?? '新侧问', patterns: [PREFIX + '**'], keepMounted: true,
  }))
  disposers.push(ctx.sidebarRightTabs.register({
    id: SIDECAR_HISTORY_TAB_TYPE, kind: SIDECAR_HISTORY_TAB_TYPE, title: () => '侧问历史',
    guide: [{ id: 'history', title: () => '侧问历史', order: 60 }],
  }))
  type BodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'sidecar.conversation'>
  function Body(props: BodyProps) {
    const { sessionId, useTabInfo, SessionProvider, renderSlot } = props
    const outline = props.useProjection('turnOutline')
    const running = props.useSession(s => s.running)
    useSyncExternalStore(subscribe, () => revision)
    const { tab } = useTabInfo()
    const clientState = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)
    const id = decodeURIComponent(tab.contentId.slice(PREFIX.length))
    const stored = saved[id]
    useEffect(() => {
      if (tab.visible && saved[id]) { saved[id] = { ...saved[id]!, usedAt: Date.now() }; changed() }
    }, [id, tab.visible])
    const value = stored?.sessionId === String(sessionId) ? stored : undefined
    const tabProps = { ctx, store: null, scope: { sessionId: String(sessionId) }, visible: tab.visible,
      tab: value ?? { id, type: tab.kind, title: '侧问' }, controller }
    if (value === undefined) return <div role="alert">侧问标签信息已清除，请从「侧问历史」重新打开。</div>
    const meta = parseSidecarTabMeta(value.meta)
    const source = meta?.kind === 'draft' ? meta.draft : clientState.recordsByParent[String(sessionId)]?.find(r => r.requestKey === meta?.requestKey)
    const progress = source ? forkProgress(outline, source.sourceSeq) : undefined
    const independent = source?.creationMode === 'independent'
    const touched = () => { if (saved[id]) { saved[id] = { ...saved[id]!, usedAt: Date.now() }; changed() } }
    return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} onPointerDownCapture={touched} onFocusCapture={touched}>
      {clientState.error && <div role="alert">{clientState.error}</div>}
      <ForkContext controller={controller} parent={String(sessionId)} independent={independent} progress={progress} running={running} draft={meta?.kind === 'draft'} />
      <div style={{ flex: 1, minHeight: 0 }}><SidecarChatTab {...tabProps} renderConversation={record =>
        <Embedded key={record.childSessionId} child={record.childSessionId} Provider={SessionProvider} renderSlot={renderSlot} />} /></div>
    </div>
  }
  function Embedded({ child, Provider, renderSlot }: { child: string; Provider: SessionProviderComponent; renderSlot: PropsRenderSlots<'sidecar.conversation'>['renderSlot'] }) {
    const [reference, setReference] = useState<SessionReference>()
    const [error, setError] = useState<string>()
    useEffect(() => {
      let live = true
      setError(undefined)
      const ref = ctx.sessions.retain(child as SessionId, { source: 'sidecarView' })
      void ref.ready.then(binding => {
        const pending = Object.values(saved).map(t => parseSidecarTabMeta(t.meta)).find(m => m?.kind === 'active' && m.childSessionId === child)
        if (pending?.kind === 'active' && pending.initialDraft && !initializedDrafts.has(child)) {
          const seed = pending.initialDraft
          const outcome = ctx.conversation.input.requestDraftInitialization(binding, { prompt: seed.question })
          if (outcome === 'blocked') throw new Error('输入框正在发送，请稍后重新打开此侧问')
          if (outcome === 'applied') {
            const input = ctx.conversation.input.for(binding.ctx)
            const references = seed.references ?? [{ parentSessionId: pending.parentSessionId, sourceMessageId: seed.sourceMessageId, sourceSeq: seed.sourceSeq, sourceKind: seed.sourceKind, quote: seed.quote }]
            for (const reference of references.filter(r => r.parentSessionId === pending.parentSessionId).reverse()) {
              if (!input.insertReference({ source: SOURCE, ref: JSON.stringify(reference), label: referenceLabel(reference), appearance: 'session', clipboardText: referenceLabel(reference) },
                { start: 0, end: 0, draftRev: input.state.getSnapshot().draftRev })) throw new Error('无法恢复引用，请重新打开此侧问')
            }
          }
          initializedDrafts.add(child)
        }
        if (live) setReference(ref)
      }).catch((reason: unknown) => { if (live) setError(String(reason)) })
      return () => { live = false; ref.release() }
    }, [child])
    if (error !== undefined) return <div role="alert">{error}</div>
    if (reference === undefined || reference.sessionId !== child) return <div>加载侧问…</div>
    return <Provider session={reference}>{renderSlot('sidecar.conversation', {})}</Provider>
  }
  function Conversation({ renderFactorySlot, inputActions, sessionId, useSession }: PropsRuntime<'sidecar.conversation'> & PropsRenderFactories) {
    const running = useSession(s => s.running)
    useEffect(() => {
      const tab = Object.values(saved).find(t => { const m = parseSidecarTabMeta(t.meta); return m?.kind === 'active' && m.childSessionId === sessionId })
      if (!running && tab) void controller.load(tab.sessionId)
    }, [sessionId, running])
    useEffect(() => {
      if (initializedDrafts.has(String(sessionId))) {
        inputActions.persistDraft()
        for (const [id, tab] of Object.entries(saved)) {
          const m = parseSidecarTabMeta(tab.meta)
          if (m?.kind === 'active' && m.childSessionId === sessionId && m.initialDraft) {
            const { initialDraft: _seed, ...meta } = m
            saved[id] = { ...tab, meta }; changed()
          }
        }
        initializedDrafts.delete(String(sessionId))
      }
      referenceInputs.set(String(sessionId), inputActions)
      for (const notify of inputWaiters) notify()
      return () => { if (referenceInputs.get(String(sessionId)) === inputActions) referenceInputs.delete(String(sessionId)) }
    }, [sessionId, inputActions])
    return renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false })
  }
  disposers.push(ctx.slots.inject('sidecar.conversation', () => ctx.slots.register({ name: 'sidecar.conversation' }, Conversation)))
  disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: SIDECAR_CHAT_TAB_TYPE,
    children: { 'sidecar.conversation': { kind: 'single', scope: 'session' } },
  }, Body)))
  function Title({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>) {
    useSyncExternalStore(subscribe, () => revision)
    const snapshot = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)
    const { tab } = useTabInfo()
    const stored = saved[decodeURIComponent(tab.contentId.slice(PREFIX.length))]
    const meta = parseSidecarTabMeta(stored?.meta)
    const record = meta === undefined ? undefined : snapshot.recordsByParent[meta.parentSessionId]?.find(item => item.requestKey === meta.requestKey)
    const draftTitle = meta?.kind === 'draft' ? (meta.draft.question.trim() ? questionTitle(meta.draft.question) : '新侧问') : undefined
    const title = (record?.title ?? draftTitle ?? stored?.title ?? '新侧问').replace(/^↳\s*侧问\s*·\s*/, '')
    return <span title={title}>{title}</span>
  }
  disposers.push(ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: SIDECAR_CHAT_TAB_TYPE,
  }, Title)))
  function History({ sessionId, useTabInfo }: PropsRuntime<'sidebar.right.pane.tab'>) {
    const { tab } = useTabInfo()
    return <SidecarHistoryTab ctx={ctx} store={null} scope={{ sessionId: String(sessionId) }}
      tab={{ id: tab.id, type: SIDECAR_HISTORY_TAB_TYPE, title: '侧问历史' }} visible={tab.visible} controller={controller} />
  }
  disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: SIDECAR_HISTORY_TAB_TYPE,
  }, History)))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

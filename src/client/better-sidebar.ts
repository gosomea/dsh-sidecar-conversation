import type { ReactNode } from 'react'
import type { SidecarDraft, SidecarRecord } from '../core/types.js'
import {
  activeSidecarTabMeta,
  draftSidecarTabMeta,
  parseSidecarTabMeta,
  sidecarTabId,
  sidecarTabPath,
  SIDECAR_CHAT_TAB_TYPE,
  SIDECAR_HISTORY_TAB_TYPE,
  type SidecarTabMeta,
} from './tab-meta.js'

/** The small public surface consumed from dsh-better-sidebar v0.14. */
export interface BetterSidebarSessionScope {
  sessionId: string
  cwd?: string
}

export interface BetterSidebarTab {
  id: string
  type: string
  title: string
  path?: string
  meta?: unknown
}

export interface BetterSidebarLeaf {
  kind: 'leaf'
  id: string
  tabs: BetterSidebarTab[]
  active: string | null
}

export interface BetterSidebarSplit {
  kind: 'split'
  id: string
  children: BetterSidebarSplitNode[]
}

export type BetterSidebarSplitNode = BetterSidebarLeaf | BetterSidebarSplit

export interface BetterSidebarSnapshot {
  sessionId: string | undefined
  state: {
    activePane: string | null
    splits: BetterSidebarSplitNode
    bottomSplits: BetterSidebarSplitNode
  } | undefined
}

export interface BetterSidebarTabState {
  sessionId?: string
  activeTabId?: string
  openTabIds: ReadonlySet<string>
}

export interface BetterSidebarTabComponentProps {
  ctx: unknown
  store: unknown
  scope: BetterSidebarSessionScope
  tab: BetterSidebarTab
  /** True only while this tab is active and its panel is visible. */
  visible: boolean
  expanded?: string[]
  onToggleDir?: (path: string) => void
  onReferenceFile?: (path: string) => void
  onOpenFile?: (path: string) => void
  onOpenDiff?: (tab: BetterSidebarTab) => void
  onSubagentJump?: (childSessionId: string) => void
}

export type SidecarTabComponent = (props: BetterSidebarTabComponentProps) => ReactNode
export type BetterSidebarTabIcon = ReactNode | ((size: number) => ReactNode)

export interface BetterSidebarTabDescriptor {
  id: string
  title: string | (() => string)
  icon?: BetterSidebarTabIcon
  order?: number
  hidden?: boolean
  single?: boolean
  component: SidecarTabComponent
}

export interface BetterSidebarOpenTabSeed {
  type: string
  title?: string
  path?: string
  id?: string
  meta?: unknown
}

export interface BetterSidebarService {
  registerTab(descriptor: BetterSidebarTabDescriptor): () => void
  openTab(seed: BetterSidebarOpenTabSeed, scope: BetterSidebarSessionScope): void
  activateTab(tabId: string, scope: BetterSidebarSessionScope): void
  updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void
  closeTab(tabId: string, scope: BetterSidebarSessionScope): void
  getSnapshot(): BetterSidebarSnapshot
  subscribeState(listener: () => void): () => void
}

/** Minimal Context shape keeps the optional service a soft dependency. */
export interface BetterSidebarContext {
  get(key: string): unknown
  effect?: (execute: () => (() => void | Promise<void>), label?: string) => (() => unknown) | unknown
  /** Cordis' dynamic child-plugin seam. It keeps this optional dependency out
   * of the parent client fiber and re-runs the callback if the provider HMRs. */
  inject?: (deps: string[], callback: (ctx: BetterSidebarContext) => void) => unknown
}

export interface SidecarTabComponents {
  chat: SidecarTabComponent
  history: SidecarTabComponent
  chatIcon?: BetterSidebarTabIcon
  historyIcon?: BetterSidebarTabIcon
}

export interface OpenSidecarDraftInput {
  parentSessionId: string
  requestKey: string
  draft: SidecarDraft
  cwd?: string
  title?: string
}

export interface OpenSidecarActiveInput {
  record: Pick<SidecarRecord, 'parentSessionId' | 'requestKey' | 'childSessionId'>
  title?: string
  cwd?: string
}

export type SidecarTabDisposer = () => void | Promise<void>

const REGISTRATION_LABEL = 'dsh-sidecar-conversation:better-sidebar-tabs'

/**
 * Register both Sidecar tab types and attach their disposers to the Cordis
 * effect. This deliberately does not declare `betterSidebar` in an inject
 * list: an absent optional panel must not leave the whole client fiber
 * pending. When the service is missing, this is an immediate no-op.
 */
export function registerSidecarTabs(
  ctx: BetterSidebarContext,
  components: SidecarTabComponents,
  onReady?: (service: BetterSidebarService) => SidecarTabDisposer | void,
): SidecarTabDisposer {
  // Prefer a dynamic child plugin whenever the host exposes Cordis' inject.
  // The child remains pending while Better Sidebar is absent; the parent
  // Sidecar client fiber is still fully active (selection/host APIs continue
  // working), and the callback is replayed after provider/HMR replacement.
  if (ctx.inject !== undefined) {
    const child = ctx.inject(['betterSidebar'], childCtx => {
      registerAvailableTabs(childCtx, components, onReady)
    })
    return disposeFiber(child)
  }

  // Small test/host contexts without `inject` still get a soft, immediate
  // lookup and never block when the optional service is missing.
  return registerAvailableTabs(ctx, components, onReady)
}

function registerAvailableTabs(
  ctx: BetterSidebarContext,
  components: SidecarTabComponents,
  onReady?: (service: BetterSidebarService) => SidecarTabDisposer | void,
): SidecarTabDisposer {
  const service = resolveBetterSidebar(ctx)
  if (service === undefined) return noop

  const register = (): SidecarTabDisposer => {
    const disposers: SidecarTabDisposer[] = []
    try {
      disposers.push(service.registerTab({
        id: SIDECAR_CHAT_TAB_TYPE,
        title: '侧问',
        ...(components.chatIcon === undefined ? {} : { icon: components.chatIcon }),
        order: 60,
        hidden: true,
        component: components.chat,
      }))
      disposers.push(service.registerTab({
        id: SIDECAR_HISTORY_TAB_TYPE,
        title: '侧问历史',
        ...(components.historyIcon === undefined ? {} : { icon: components.historyIcon }),
        order: 61,
        single: true,
        component: components.history,
      }))
      const readyDisposer = onReady?.(service)
      if (typeof readyDisposer === 'function') disposers.push(readyDisposer)
    } catch (error) {
      for (const dispose of disposers.reverse()) void dispose()
      throw error
    }
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const pending: Promise<void>[] = []
      for (const dispose of disposers.reverse()) {
        const result = dispose()
        if (isPromiseLike(result)) pending.push(Promise.resolve(result))
      }
      if (pending.length > 0) return Promise.all(pending).then(() => undefined)
    }
  }

  // `ctx.effect` runs its body immediately and owns its returned disposer.
  // Keeping the local disposer as a fallback also makes this helper usable in
  // small host/test contexts that expose no Cordis effect method.
  if (ctx.effect === undefined) return register()
  let localDispose: SidecarTabDisposer | undefined
  const effectDispose = ctx.effect(() => {
    localDispose = register()
    return localDispose
  }, REGISTRATION_LABEL)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (typeof effectDispose === 'function') {
      const result = effectDispose()
      return isPromiseLike(result) ? Promise.resolve(result).then(() => undefined) : undefined
    }
    return localDispose?.()
  }
}

function disposeFiber(value: unknown): SidecarTabDisposer {
  if (typeof value !== 'object' || value === null) return noop
  const dispose = (value as { dispose?: unknown }).dispose
  if (typeof dispose !== 'function') return noop
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const result = (dispose as () => unknown).call(value)
    return isPromiseLike(result) ? Promise.resolve(result).then(() => undefined) : undefined
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return typeof value === 'object' && value !== null
    && typeof (value as { then?: unknown }).then === 'function'
}

/** Open a new draft and explicitly bind it to its parent session. */
export function openSidecarDraft(service: BetterSidebarService, input: OpenSidecarDraftInput): void {
  const meta = draftSidecarTabMeta(input.parentSessionId, input.requestKey, input.draft)
  const scope = sessionScope(input.parentSessionId, input.cwd)
  const tabId = sidecarTabId(input.requestKey)
  openAndActivate(service, {
    type: SIDECAR_CHAT_TAB_TYPE,
    id: tabId,
    path: sidecarTabPath(input.requestKey),
    ...(input.title === undefined ? {} : { title: input.title }),
    meta,
  }, scope, tabId)
}

/** Open an existing persistent Sidecar and bind it to its immutable parent. */
export function openSidecarActive(service: BetterSidebarService, input: OpenSidecarActiveInput): void {
  const { record } = input
  const meta = activeSidecarTabMeta(record)
  const scope = sessionScope(record.parentSessionId, input.cwd)
  const tabId = sidecarTabId(record.requestKey)
  openAndActivate(service, {
    type: SIDECAR_CHAT_TAB_TYPE,
    id: tabId,
    path: sidecarTabPath(record.requestKey),
    ...(input.title === undefined ? {} : { title: input.title }),
    meta,
  }, scope, tabId)
}

/** Replace draft meta with active meta without changing the stable tab id/path. */
export function updateSidecarActive(
  service: BetterSidebarService,
  record: Pick<SidecarRecord, 'parentSessionId' | 'requestKey' | 'childSessionId'>,
  title?: string,
): void {
  const patch = {
    path: sidecarTabPath(record.requestKey),
    meta: activeSidecarTabMeta(record),
    ...(title === undefined ? {} : { title }),
  }
  service.updateTab(sidecarTabId(record.requestKey), patch)
}

/** Open the one history tab for a parent session. */
export function openSidecarHistory(
  service: BetterSidebarService,
  parentSessionId: string,
  cwd?: string,
): void {
  const scope = sessionScope(parentSessionId, cwd)
  openAndActivate(service, {
    type: SIDECAR_HISTORY_TAB_TYPE,
    id: SIDECAR_HISTORY_TAB_TYPE,
    path: `${sidecarTabPath('history')}:${encodeURIComponent(parentSessionId)}`,
  }, scope, SIDECAR_HISTORY_TAB_TYPE)
}

/**
 * Better Sidebar restores per-session pane state asynchronously around page
 * boot/session switches. Replaying the idempotent open on the next paint
 * prevents that restore from selecting the previously active tab after the
 * Sidecar click. The second open dedupes by id and acts only as a focus.
 */
function openAndActivate(
  service: BetterSidebarService,
  seed: BetterSidebarOpenTabSeed,
  scope: BetterSidebarSessionScope,
  tabId: string,
): void {
  const focus = (): void => {
    service.openTab(seed, scope)
    service.activateTab(tabId, scope)
  }
  focus()
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(() => { focus() })
  }
}

/** Close a Sidecar tab in the state bucket of its parent session. */
export function closeSidecar(
  service: BetterSidebarService,
  parentSessionId: string,
  requestKey: string,
  cwd?: string,
): void {
  service.closeTab(sidecarTabId(requestKey), sessionScope(parentSessionId, cwd))
}

/** Read and validate the meta exposed by a Better Sidebar tab component. */
export function sidecarMetaFromTab(tab: Pick<BetterSidebarTab, 'meta'>): SidecarTabMeta | undefined {
  return parseSidecarTabMeta(tab.meta)
}

/**
 * Inspect the public Better Sidebar snapshot without depending on its npm
 * types at runtime. Legacy migration uses this to avoid reopening an
 * already-persisted Sidecar and, more importantly, to preserve the tab the
 * user is currently looking at.
 */
export function betterSidebarTabState(snapshot: BetterSidebarSnapshot): BetterSidebarTabState {
  const openTabIds = new Set<string>()
  const leaves: BetterSidebarLeaf[] = []
  if (snapshot.state !== undefined) {
    collectLeaves(snapshot.state.splits, leaves, openTabIds)
    collectLeaves(snapshot.state.bottomSplits, leaves, openTabIds)
  }
  const activeLeaf = leaves.find(leaf => leaf.id === snapshot.state?.activePane)
    ?? leaves.find(leaf => leaf.active !== null)
  return {
    ...(snapshot.sessionId === undefined ? {} : { sessionId: snapshot.sessionId }),
    ...(activeLeaf?.active === null || activeLeaf?.active === undefined
      ? {}
      : { activeTabId: activeLeaf.active }),
    openTabIds,
  }
}

function collectLeaves(
  node: BetterSidebarSplitNode,
  leaves: BetterSidebarLeaf[],
  ids: Set<string>,
): void {
  if (node.kind === 'leaf') {
    leaves.push(node)
    for (const tab of node.tabs) ids.add(tab.id)
    return
  }
  for (const child of node.children) collectLeaves(child, leaves, ids)
}

/** Resolve the optional service without creating an inject-time dependency. */
export function resolveBetterSidebar(ctx: BetterSidebarContext): BetterSidebarService | undefined {
  let value: unknown
  try {
    value = ctx.get('betterSidebar')
  } catch {
    return undefined
  }
  if (!isService(value)) return undefined
  return value
}

function isService(value: unknown): value is BetterSidebarService {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<BetterSidebarService>
  return typeof candidate.registerTab === 'function'
    && typeof candidate.openTab === 'function'
    && typeof candidate.activateTab === 'function'
    && typeof candidate.updateTab === 'function'
    && typeof candidate.closeTab === 'function'
    && typeof candidate.getSnapshot === 'function'
    && typeof candidate.subscribeState === 'function'
}

function sessionScope(sessionId: string, cwd?: string): BetterSidebarSessionScope {
  return { sessionId, ...(cwd === undefined || cwd === '' ? {} : { cwd }) }
}

function noop(): void {
  // Optional Better Sidebar is intentionally a no-op when not installed.
}

export const registerBetterSidebarTabs = registerSidecarTabs
export const registerSidecarBetterSidebarTabs = registerSidecarTabs

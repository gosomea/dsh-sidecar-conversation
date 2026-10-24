import { useEffect, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot, StoreHandle } from '@deepseek-ai/dsh-client-store'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SidecarController } from './controller.js'
import { nativeTitle, plainTitle } from './presentation.js'

type View = Parameters<Parameters<WorkspaceBrowserProps['useStore']>[0]>[0]
type Sessions = Parameters<Parameters<WorkspaceBrowserProps['useSessions']>[0]>[0]
type Workspaces = Parameters<Parameters<WorkspaceBrowserProps['useWorkspaces']>[0]>[0]

/** Read-only projection of DSH's existing Workspace view preferences. No second persisted order. */
export function workspaceOrder(list: Sessions, workspaces: Workspaces, view: View): string[] {
  const archived = new Set<string>(workspaces.archivedSessionIds)
  const pinned = new Set<string>(workspaces.pinnedSessionIds)
  const current = Object.values(list.byId).find(s => (s.retainedBy.mainView ?? 0) > 0)
  const known = (id: string) => list.byId[id as keyof typeof list.byId]
  const visible = (id: string) => { const s = known(id); return s !== undefined && s.origin !== 'subagent' && (!s.blank || s.id === current?.id) }
  const recent = (ids: readonly string[]) => ids.filter(id => known(id)).sort((a, b) => known(b)!.updatedAt - known(a)!.updatedAt || (a < b ? -1 : 1))
  const order = (members: readonly string[], key: string) => {
    let ids: string[]
    if (view.orderBy === 'updated') ids = recent(members)
    else {
      const included = new Set<string>()
      const saved = (view.sessionOrderByAccount[key] ?? []).filter(id => members.includes(id) && !included.has(id) && !!included.add(id))
      const pins = workspaces.pinnedSessionIds.filter(id => members.includes(id) && known(id) && !archived.has(id) && !included.has(id) && !!included.add(id))
      const missing = recent(members.filter(id => !included.has(id)))
      const ordinary = missing.filter(id => !archived.has(id))
      ids = [...pins, ...saved, ...ordinary, ...missing.filter(id => archived.has(id))]
      const pending = new Set(ordinary)
      const placeFork = (id: string) => {
        if (!pending.delete(id)) return
        const parent = known(id)?.parentId
        if (!parent || parent === id || !ids.includes(parent)) return
        placeFork(parent)
        ids.splice(ids.indexOf(id), 1)
        ids.splice(ids.indexOf(parent), 0, id)
      }
      for (const id of ordinary.toReversed()) placeFork(id)
    }
    const rows = ids.filter(visible)
    return [
      ...rows.filter(id => known(id)!.blank),
      ...rows.filter(id => !known(id)!.blank && pinned.has(id) && !archived.has(id)),
      ...rows.filter(id => !known(id)!.blank && (!pinned.has(id) || archived.has(id))),
    ]
  }
  if (view.groupBy === 'flat') return order(list.ids.filter(visible), '__flat_session_order__')
  const accounted = new Set(workspaces.items.flatMap(w => w.sessionIds))
  const groups = workspaces.items.map(w => ({ key: w.workspaceId, path: w.path, ids: order(w.sessionIds, w.workspaceId) }))
  // Native workspace trees render child folders before their parent's Session rows.
  const parent = (path: string) => groups.filter(g => path !== g.path && path.startsWith(g.path.endsWith('/') ? g.path : g.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]?.key
  const visit = (key: string | undefined): string[] => groups.filter(g => (view.groupBy === 'workspace-tree' ? parent(g.path) : undefined) === key).flatMap(g => [...visit(g.key), ...g.ids])
  return [...visit(undefined), ...order(list.ids.filter(id => !accounted.has(id)), '')]
}

/** Uses the public slot ledger and the browser's existing root store handle. */
export function registerWorkspaceAdapter(ctx: Context, controller: SidecarController): ObservableSnapshot<readonly string[]> & { dispose(): void } {
  let snapshot: readonly string[] = []
  const listeners = new Set<() => void>()
  const publish = (ids: readonly string[]) => {
    if (ids.length === snapshot.length && ids.every((id, i) => id === snapshot[i])) return
    snapshot = ids
    for (const listener of listeners) listener()
  }
  function OrderBridge({ useStore, useSessions, useWorkspaces }: Pick<WorkspaceBrowserProps, 'useStore' | 'useSessions' | 'useWorkspaces'>) {
    const view = useStore(s => s)
    const sessions = useSessions(s => s)
    const workspaces = useWorkspaces(s => s)
    useEffect(() => { publish(workspaceOrder(sessions, workspaces, view)) }, [view, sessions, workspaces])
    return null
  }
  const stopOrder = ctx.slots.inject('shell.overlay', () => {
    let handle: StoreHandle<View, {}> | undefined
    let stop: (() => void) | undefined
    const sync = () => {
      const store = ctx.slots.entriesOfSlot('sidebar.workspaces')[0]?.store
      const next = store && typeof store !== 'function' ? store as StoreHandle<View, {}> : undefined
      if (next === handle) return
      stop?.(); handle = next
      stop = next ? ctx.slots.register({ name: 'shell.overlay', id: 'sidecar-workspace-order', store: next }, OrderBridge) : undefined
      if (!next) publish([])
    }
    const unsubscribe = ctx.slots.subscribe('sidebar.workspaces', sync)
    sync()
    return () => { unsubscribe(); stop?.() }
  })
  function Leading({ sessionId }: PropsRuntime<'sidebar.session.row.leading'>) {
    const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)
    const sessions = useSyncExternalStore(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot)
    const record = Object.values(state.recordsByParent).flat().find(r => r.childSessionId === sessionId)
    const title = sessions.byId[sessionId]?.title
    if (title && plainTitle(title) !== title) return null
    return record && record.creationMode !== 'independent' ? <span title="关联侧问" aria-label="关联侧问">↳</span> : null
  }
  function Hover({ sessionId }: PropsRuntime<'sidebar.session.row.hover'>) {
    const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)
    const sessions = useSyncExternalStore(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot)
    const record = Object.values(state.recordsByParent).flat().find(r => r.childSessionId === sessionId)
    if (!record) return null
    const parent = sessions.byId[record.parentSessionId as keyof typeof sessions.byId]
    return <span>{record.creationMode === 'independent' ? '独立新会话' : '关联侧问'} · {parent?.title || nativeTitle(record, sessions)}</span>
  }
  const stopLeading = ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({ name: 'sidebar.session.row.leading', id: 'sidecar-lineage', order: 10 }, Leading))
  const stopHover = ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({ name: 'sidebar.session.row.hover', id: 'sidecar-lineage', order: 10 }, Hover))
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose: () => { stopOrder(); stopLeading(); stopHover(); listeners.clear() },
  }
}

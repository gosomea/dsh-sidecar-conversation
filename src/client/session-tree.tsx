import { useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StoredEntry, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Button, Menu, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidecarRecord } from '../core/types.js'
import type { SidecarController } from './controller.js'
import { workspaceOrder } from './workspace-adapter.js'
import { plainTitle } from './presentation.js'
import css from './session-tree.module.css'

export interface SessionTreeNode { id: string; children: SessionTreeNode[] }
/** The registry owns sidecar lineage, including on hosts whose Fork logs are independent. */
export function sessionTree(ids: readonly string[], records: readonly Pick<SidecarRecord, 'parentSessionId' | 'childSessionId' | 'creationMode'>[]): SessionTreeNode[] {
  const nodes = new Map(ids.map(id => [id, { id, children: [] } as SessionTreeNode]))
  const parents = new Map<string, string>()
  for (const r of records) if (r.creationMode !== 'independent' && r.parentSessionId !== r.childSessionId && nodes.has(r.parentSessionId) && nodes.has(r.childSessionId)) parents.set(r.childSessionId, r.parentSessionId)
  const roots: SessionTreeNode[] = []
  for (const [id, node] of nodes) {
    const seen = new Set([id]); let ancestor = parents.get(id); let cycle = false
    while (ancestor) { if (seen.has(ancestor)) { cycle = true; break }; seen.add(ancestor); ancestor = parents.get(ancestor) }
    const parent = !cycle && parents.get(id)
    if (parent) nodes.get(parent)!.children.push(node)
    else roots.push(node)
  }
  return roots
}

const FOLDS = 'dsh-sidecar-session-folds-v1'
const MODE = 'dsh-sidecar-session-tree-v1'
/** A public single-slot override, disposable to return to the shipped browser. */
export function registerSessionTree(ctx: Context, controller: SidecarController): () => void {
  let enabled = true
  try { enabled = localStorage.getItem(MODE) !== 'false' } catch { /* Optional view preference. */ }
  let stopTree: (() => void) | undefined
  let original: StoredEntry | undefined
  let syncing = false
  const listeners = new Set<() => void>()
  const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
  const setEnabled = (value: boolean) => {
    enabled = value
    try { localStorage.setItem(MODE, String(value)) } catch { /* View still works without persistence. */ }
    sync()
    for (const fn of listeners) fn()
  }
  type TreeProps = Omit<WorkspaceBrowserProps, 'renderSlot'>
  function Tree(props: TreeProps) {
    const sessions = props.useSessions(s => s)
    const workspaces = props.useWorkspaces(s => s)
    const view = props.useStore(s => s)
    const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)
    const current = useSyncExternalStore(ctx.uiSession.adapter.current.subscribe, ctx.uiSession.adapter.current.getSnapshot).key
    const [query, setQuery] = useState('')
    const [folded, setFolded] = useState<Record<string, boolean>>(() => {
      try { const value = JSON.parse(localStorage.getItem(FOLDS) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
    })
    const toggle = (id: string) => setFolded(previous => {
      const next = { ...previous, [id]: !previous[id] }
      try { localStorage.setItem(FOLDS, JSON.stringify(next)) } catch { /* Optional view preference. */ }
      return next
    })
    const archived = new Set<string>(workspaces.archivedSessionIds)
    const pinned = new Set<string>(workspaces.pinnedSessionIds)
    const ids = workspaceOrder(sessions, workspaces, view).filter(id => view.archivedFilter === 'only' ? archived.has(id) : view.archivedFilter === 'show' || !archived.has(id))
    const roots = sessionTree(ids, Object.values(state.recordsByParent).flat())
    const title = (id: string) => plainTitle(sessions.byId[id as SessionId]?.title || sessions.byId[id as SessionId]?.displayTitle || '未命名') || '未命名'
    const matches = (node: SessionTreeNode): boolean => title(node.id).toLocaleLowerCase().includes(query.toLocaleLowerCase()) || node.children.some(matches)
    const visible = query.trim() ? roots.filter(matches) : roots
    const membership = new Map(workspaces.items.flatMap(w => w.sessionIds.map(id => [String(id), w.workspaceId] as const)))
    const groups = view.groupBy === 'flat' ? [{ id: '', title: '会话', nodes: visible }] : [
      ...workspaces.items.map(w => ({ id: w.workspaceId, title: w.title || w.path, nodes: visible.filter(n => membership.get(n.id) === w.workspaceId) })),
      { id: '', title: '未分组', nodes: visible.filter(n => !membership.has(n.id)) },
    ]
    if (!props.wide) return <Button variant="ghost" onClick={props.expandSidebar} title="展开会话层级">☷</Button>
    const row = (node: SessionTreeNode, depth = 0): import('react').ReactNode => {
      const id = node.id as SessionId
      const expanded = !!query || !folded[id]
      return <div key={id} role="listitem" data-sidecar-tree-session={id}>
        <div className={css.row} data-selected={id === current} style={{ paddingLeft: 4 + depth * 16 }}>
          {node.children.length > 0 ? <button type="button" className={css.fold} aria-label={`${expanded ? '折叠' : '展开'} ${title(id)} 的侧问`} aria-expanded={expanded} onClick={() => toggle(id)}>{expanded ? '⌄' : '›'}</button> : <span className={css.spacer} />}
          <button type="button" className={css.title} aria-current={id === current ? 'page' : undefined} title={title(id)} onClick={() => archived.has(id) ? props.notifyArchivedNotOpenable() : props.open(id)} onDoubleClick={() => props.requestSessionRename(id, title(id))}>
            {sessions.byId[id]?.running && <span aria-label="运行中" className={css.running}>● </span>}{pinned.has(id) && <span aria-label="已置顶">⌖ </span>}{title(id)}
          </button>
          {node.children.length > 0 && <span className={css.count}>{node.children.length}</span>}
          <Actions id={id} title={title(id)} archived={archived.has(id)} pinned={pinned.has(id)} rename={() => props.requestSessionRename(id, title(id))} />
        </div>
        {expanded && node.children.length > 0 && <div role="list">{node.children.filter(n => !query || matches(n)).map(n => row(n, depth + 1))}</div>}
      </div>
    }
    return <section className={css.tree} aria-label="会话层级">
      <div className={css.toolbar}><input aria-label="按标题筛选会话" placeholder="筛选会话" value={query} onChange={e => setQuery(e.target.value)} /><Button size="sm" variant="ghost" title="原生工作区管理、全文搜索与排序" onClick={() => setEnabled(false)}>管理</Button></div>
      {state.error && <div role="alert">{state.error}</div>}
      {groups.filter(g => g.nodes.length).map(group => <div key={group.id}>
        <button type="button" className={css.group} aria-expanded={!!query || !folded['workspace:' + group.id]} onClick={() => toggle('workspace:' + group.id)}>{folded['workspace:' + group.id] && !query ? '›' : '⌄'} {group.title}</button>
        {(!folded['workspace:' + group.id] || !!query) && <div role="list">{group.nodes.map(n => row(n))}</div>}
      </div>)}
      {!visible.length && <p className={css.empty}>没有匹配的会话</p>}
    </section>
  }
  function Actions({ id, title, archived, pinned, rename }: { id: SessionId; title: string; archived: boolean; pinned: boolean; rename(): void }) {
    const [open, setOpen] = useState(false)
    const run = (fn: () => Promise<unknown>) => { setOpen(false); void fn().catch(error => controller.store.setError(error)) }
    return <Menu open={open} onClose={() => setOpen(false)} portal anchor={<button type="button" className={css.actions} aria-label={`${title} 的操作`} onClick={() => setOpen(!open)}>···</button>}>
      <MenuItemButton onSelect={() => run(() => pinned ? ctx.uiWorkspace.unpinSession(id) : ctx.uiWorkspace.pinSession(id))}>{pinned ? '取消置顶' : '置顶'}</MenuItemButton>
      <MenuItemButton onSelect={() => { setOpen(false); rename() }}>重命名</MenuItemButton>
      <MenuItemButton onSelect={() => run(() => archived ? ctx.uiWorkspace.unarchiveSession(id) : ctx.uiWorkspace.archiveSession(id))}>{archived ? '取消归档' : '归档'}</MenuItemButton>
    </Menu>
  }
  function Toggle({ wide }: PropsRuntime<'sidebar.footer.action'>) {
    const active = useSyncExternalStore(subscribe, () => enabled)
    return <Button size="sm" variant="ghost" title={active ? '切换到原生列表' : '切换到会话层级'} onClick={() => setEnabled(!active)}>{wide ? active ? '原生列表' : '会话层级' : '☷'}</Button>
  }
  function sync() {
    if (syncing) return
    syncing = true
    try {
      const native = ctx.slots.entries('sidebar.workspaces').find(e => e.component !== Tree)
      if (native === original && !!stopTree === (enabled && !!native)) return
      stopTree?.(); stopTree = undefined; original = native
      if (enabled && native?.store && native.inject) {
        // The public slot ledger exposes the existing store and action factory.
        // No private module imports or duplicate native child-slot declarations.
        stopTree = ctx.slots.register({ name: 'sidebar.workspaces', priority: -10, store: native.store, inject: native.inject, locale: native.locale } as never, Tree)
      }
    } finally { syncing = false }
  }
  const stopWatch = ctx.slots.subscribe('sidebar.workspaces', sync)
  const stopToggle = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'sidecar-tree-mode' }, Toggle))
  sync()
  return () => { stopWatch(); stopToggle(); stopTree?.(); listeners.clear() }
}

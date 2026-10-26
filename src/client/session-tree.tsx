import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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

const MODE = 'dsh-sidecar-session-tree-v1'
const FOLDS = 'dsh-sidecar-session-folds-v1'
/** Reuses the native browser's public store and injected Host operations. */
export function registerSessionTree(ctx: Context, controller: SidecarController): () => void {
  let enabled = false
  try { enabled = localStorage.getItem(MODE) === 'true' } catch { /* Optional preference. */ }
  const listeners = new Set<() => void>()
  const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
  const setEnabled = (value: boolean) => {
    enabled = value
    try { localStorage.setItem(MODE, String(value)) } catch { /* Optional preference. */ }
    sync()
    for (const fn of listeners) fn()
  }
  let stopTree: (() => void) | undefined
  let original: StoredEntry | undefined
  let syncing = false
  type TreeProps = Omit<WorkspaceBrowserProps, 'renderSlot'>
  function Tree(props: TreeProps) {
    const sessions = props.useSessions(s => s)
    const workspaces = props.useWorkspaces(s => s)
    const view = props.useStore(s => s)
    const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)
    const current = useSyncExternalStore(ctx.uiSession.adapter.current.subscribe, ctx.uiSession.adapter.current.getSnapshot).key
    const searchInput = useRef<HTMLInputElement>(null)
    const searchRequest = props.useWorkspaceShortcuts(s => s.searchRequest)
    useEffect(() => { if (searchRequest) { props.expandSidebar(); searchInput.current?.focus() } }, [searchRequest])
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [query, setQuery] = useState('')
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const [search, setSearch] = useState<{ query: string; items: { sessionId: SessionId; snippet: string }[]; status: 'idle' | 'loading' | 'ready' | 'error' | 'disabled'; error?: string; hasMore: boolean }>({ query: '', items: [], status: 'idle', hasMore: false })
    useEffect(() => {
      if (!normalizedQuery) return
      const abort = new AbortController()
      setSearch({ query: normalizedQuery, items: [], status: 'loading', hasMore: false })
      const timer = setTimeout(() => {
        void props.searchSessions(normalizedQuery, abort.signal).then(result => {
          if (!abort.signal.aborted) setSearch({ query: normalizedQuery, items: [...result.items], hasMore: result.hasMore, status: 'ready' })
        }, error => { if (!abort.signal.aborted) setSearch({ query: normalizedQuery, items: [], hasMore: false, status: /session search is disabled|SESSION_QUERY_SEARCH_DISABLED/.test(String(error)) ? 'disabled' : 'error', error: error instanceof Error ? error.message : String(error) }) })
      }, 200)
      return () => { clearTimeout(timer); abort.abort() }
    }, [normalizedQuery, props.searchSessions])
    const drag = useRef<{ id: string; parent: string; account: string } | null>(null)
    const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
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
    const title = (id: string) => {
      const summary = sessions.byId[id as SessionId]
      return summary?.blank ? '新会话' : plainTitle(summary?.title || summary?.displayTitle || '未命名') || '未命名'
    }
    const snippets = new Map(search.query === normalizedQuery ? search.items.map(item => [String(item.sessionId), item.snippet]) : [])
    const workspaceMatches = new Set(workspaces.items.filter(w => `${w.title} ${w.path}`.toLocaleLowerCase().includes(normalizedQuery)).flatMap(w => w.sessionIds as readonly string[]))
    const matches = (node: SessionTreeNode): boolean => title(node.id).toLocaleLowerCase().includes(normalizedQuery) || workspaceMatches.has(node.id) || snippets.has(node.id) || node.children.some(matches)
    const visible = normalizedQuery ? roots.filter(matches) : roots
    const membership = new Map(workspaces.items.flatMap(w => w.sessionIds.map(id => [String(id), w.workspaceId] as const)))
    const groups = view.groupBy === 'flat' ? [{ id: '', title: '会话', nodes: visible }] : [
      ...workspaces.items.map(w => ({ id: w.workspaceId, title: w.title || w.path, nodes: visible.filter(n => membership.get(n.id) === w.workspaceId) })),
      { id: '', title: '未分组', nodes: visible.filter(n => !membership.has(n.id)) },
    ]
    const accounts = Object.fromEntries([
      ...workspaces.items.map(w => [w.workspaceId, [...w.sessionIds]] as const),
      ['', sessions.ids.filter(id => !membership.has(id))],
      ['__flat_session_order__', [...sessions.ids]],
    ]) as Record<string, readonly string[]>
    const orders = Object.fromEntries(Object.entries(accounts).map(([key, members]) => [key, workspaceOrder(
      { ...sessions, ids: members as SessionId[] }, workspaces,
      { ...view, groupBy: 'flat', sessionOrderByAccount: { __flat_session_order__: view.sessionOrderByAccount[key] ?? [] } }, true,
    )]))
    const accountOf = (id: string) => view.groupBy === 'flat' ? '__flat_session_order__' : membership.get(id) ?? ''
    const canDrop = (id: string, parent: string) => {
      const source = drag.current
      return !normalizedQuery && !!source && source.id !== id && source.parent === parent && source.account === accountOf(id)
        && pinned.has(source.id) === pinned.has(id) && !sessions.byId[id as SessionId]?.blank
    }
    if (!props.wide) return <Button variant="ghost" onClick={props.expandSidebar} title="展开会话层级">☷</Button>
    const row = (node: SessionTreeNode, depth = 0, parent = ''): import('react').ReactNode => {
      const id = node.id as SessionId
      const expanded = !!normalizedQuery || !folded[id]
      return <div key={id} role="listitem" data-sidecar-tree-session={id}>
        <div className={css.row} data-selected={id === current} data-drop={drop?.id === id ? drop.after ? 'after' : 'before' : undefined} style={{ paddingLeft: 4 + depth * 16 }}
          draggable={!normalizedQuery && !sessions.byId[id]?.blank}
          onDragStart={event => { drag.current = { id, parent, account: accountOf(id) }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }}
          onDragOver={event => { if (!canDrop(id, parent)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDrop({ id, after: event.clientY > rect.top + rect.height / 2 }) }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null) }}
          onDragEnd={() => { drag.current = null; setDrop(null) }}
          onDrop={event => {
            event.preventDefault()
            const source = drag.current
            if (source && canDrop(id, parent)) {
              const rect = event.currentTarget.getBoundingClientRect()
              const next = reorderSessions(orders[source.account] ?? [], source.id, id, event.clientY > rect.top + rect.height / 2)
              if (next) props.actions.setSessionOrder(source.account, next as SessionId[], orders as Record<string, SessionId[]>)
            }
            drag.current = null; setDrop(null)
          }}>
          {node.children.length > 0 ? <button type="button" className={css.fold} aria-label={`${expanded ? '折叠' : '展开'} ${title(id)} 的侧问`} aria-expanded={expanded} onClick={() => toggle(id)}>{expanded ? '⌄' : '›'}</button> : <span className={css.spacer} />}
          <button type="button" className={css.title} aria-current={id === current ? 'page' : undefined} title={title(id)} onClick={() => archived.has(id) ? props.notifyArchivedNotOpenable() : props.open(id)} onDoubleClick={() => { if (!sessions.byId[id]?.blank) props.requestSessionRename(id, title(id)) }}>
            {sessions.byId[id]?.running && <span aria-label="运行中" className={css.running}>● </span>}{pinned.has(id) && <span aria-label="已置顶">⌖ </span>}{title(id)}{normalizedQuery && snippets.get(id) && <span className={css.snippet}>{snippets.get(id)}</span>}
          </button>
          {node.children.length > 0 && <span className={css.count}>{node.children.length}</span>}
          {!sessions.byId[id]?.blank && <Actions id={id} title={title(id)} archived={archived.has(id)} pinned={pinned.has(id)} rename={() => props.requestSessionRename(id, title(id))} />}
        </div>
        {expanded && node.children.length > 0 && <div role="list">{node.children.filter(n => !normalizedQuery || matches(n)).map(n => row(n, depth + 1, id))}</div>}
      </div>
    }
    const parentGroup = (id: string) => {
      if (view.groupBy !== 'workspace-tree' || !id) return undefined
      const path = workspaces.items.find(w => w.workspaceId === id)?.path.replaceAll('\\', '/')
      return path && workspaces.items.filter(w => w.workspaceId !== id && path.startsWith(w.path.replaceAll('\\', '/').replace(/\/$/, '') + '/'))
        .sort((a, b) => b.path.length - a.path.length)[0]?.workspaceId
    }
    const groupVisible = (id: string): boolean => !normalizedQuery && !!id || !!groups.find(g => g.id === id)?.nodes.length || groups.some(g => parentGroup(g.id) === id && groupVisible(g.id))
    const renderGroups = (parent?: string, depth = 0): import('react').ReactNode => groups.filter(g => parentGroup(g.id) === parent && groupVisible(g.id)).map(group => {
      const expanded = !!normalizedQuery || view.groupExpansion?.[group.id] !== false
      return <div key={group.id}>
        <div className={css.groupHeader}><button type="button" className={css.group} style={{ paddingLeft: 4 + depth * 12 }} aria-expanded={expanded} onClick={() => props.actions.setGroupExpanded(group.id, !expanded)}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={expanded ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} /></svg><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg><span className={css.groupTitle}>{group.title}</span></button>
        {group.id && <button type="button" className={css.create} aria-label={`在 ${group.title} 新建会话`} title="新建会话" onClick={() => { props.actions.setGroupExpanded(group.id, true); props.startSession(group.id as Parameters<TreeProps['startSession']>[0]) }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 5v14M5 12h14" /></svg></button>}</div>
        {expanded && <>{renderGroups(group.id, depth + 1)}<div role="list">{group.nodes.map(n => row(n, depth))}</div></>}
      </div>
    })
    return <section className={css.tree} aria-label="会话层级">
      <div className={css.toolbar}><input ref={searchInput} type="search" aria-label="搜索会话" placeholder="搜索会话" value={query} onChange={e => setQuery(e.target.value)} /><Button size="sm" variant="ghost" aria-label="列表显示选项" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>☷</Button></div>
      {filtersOpen && <div className={css.filters}>
        <select aria-label="会话分组" value={view.groupBy} onChange={e => props.actions.setGroupBy(e.target.value as 'flat' | 'workspace' | 'workspace-tree')}><option value="workspace">按工作区</option><option value="workspace-tree">工作区目录</option><option value="flat">全部会话</option></select>
        <select aria-label="会话排序" value={view.orderBy} onChange={e => props.actions.setOrderBy(e.target.value as 'manual' | 'updated', orders as Record<string, SessionId[]>)}><option value="updated">最近更新</option><option value="manual">手动排序</option></select>
        <select aria-label="归档筛选" value={view.archivedFilter ?? 'default'} onChange={e => props.actions.setArchivedFilter(e.target.value as 'default' | 'show' | 'only')}><option value="default">未归档</option><option value="show">包含归档</option><option value="only">已归档</option></select>
      </div>}
      {normalizedQuery && (search.query !== normalizedQuery || search.status === 'loading') && <p role="status" className={css.empty}>搜索中…</p>}
      {normalizedQuery && search.query === normalizedQuery && search.status === 'error' && <p role="alert" title={search.error} className={css.empty}>全文搜索失败，当前仅显示标题匹配</p>}
      {normalizedQuery && search.query === normalizedQuery && search.hasMore && <p className={css.empty}>结果较多，请缩小搜索范围</p>}
      {state.error && <div role="alert">{state.error}</div>}
      {renderGroups()}
      {!visible.length && (!normalizedQuery || search.query === normalizedQuery && search.status !== 'loading') && <p className={css.empty}>没有匹配的会话</p>}
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
    const label = active ? '切换到原生列表' : '切换到侧问层级列表'
    return <Button size="sm" variant="ghost" title={label} aria-label={label} onClick={() => setEnabled(!active)}>{wide ? active ? '原生列表' : '侧问层级列表' : '☷'}</Button>
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

/** Move one sibling while retaining hidden/archived members in the native account. */
export function reorderSessions(order: readonly string[], source: string, target: string, after: boolean): string[] | undefined {
  if (source === target || !order.includes(source) || !order.includes(target)) return
  const next = order.filter(id => id !== source)
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source)
  return next.every((id, i) => id === order[i]) ? undefined : next
}

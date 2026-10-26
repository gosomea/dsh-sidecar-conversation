/* @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { sessionTree, registerSessionTree, reorderSessions } from '../src/client/session-tree.js'
import { workspaceOrder } from '../src/client/workspace-adapter.js'
import { SidecarController } from '../src/client/controller.js'
import { createSnapshotStore } from './snapshot-fixture.js'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({ ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(),
  Button: ({ children, variant: _v, size: _s, ...props }: any) => createElement('button', props, children),
  Menu: ({ anchor }: any) => anchor,
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const relation = (parentSessionId: string, childSessionId: string, creationMode: 'fork' | 'independent' = 'fork') => ({ parentSessionId, childSessionId, creationMode })
beforeEach(() => { localStorage.setItem('dsh-sidecar-session-tree-v1', 'true') })
afterEach(() => { localStorage.clear(); document.body.innerHTML = '' })
it('uses plugin associations without native parent metadata and leaves independent chats top-level', () => {
  expect(sessionTree(['child', 'independent', 'parent', 'nested'], [relation('parent', 'child'), relation('parent', 'independent', 'independent'), relation('child', 'nested')])).toEqual([
    { id: 'independent', children: [] }, { id: 'parent', children: [{ id: 'child', children: [{ id: 'nested', children: [] }] }] },
  ])
})
it('keeps orphans visible and breaks cycles instead of losing or looping Sessions', () => {
  expect(sessionTree(['a', 'b', 'c'], [relation('missing', 'c'), relation('a', 'b'), relation('b', 'a')])).toEqual(['a', 'b', 'c'].map(id => ({ id, children: [] })))
})
it('keeps sibling ordering from the native order projection', () => {
  expect(sessionTree(['second', 'parent', 'first'], [relation('parent', 'first'), relation('parent', 'second')])[0]?.children.map(n => n.id)).toEqual(['second', 'first'])
})
it('renders and persists folds in one list and disposes without touching session data', () => {
  const controller = new SidecarController()
  controller.store.setRecords('parent', [{ ...relation('parent', 'child'), sourceKind: 'selection' } as any])
  const entries: any[] = []
  const stop = vi.fn()
  const ctx: any = {
    uiSession: { adapter: { current: createSnapshotStore({ key: 'parent' }) } },
    slots: {
      entries: () => [{ component: () => null, store: {}, inject: () => ({}) }],
      subscribe: () => () => {}, inject: (_: string, f: any) => f(),
      register: (options: any, component: any) => { entries.push({ options, component }); return stop },
    },
  }
  const dispose = registerSessionTree(ctx, controller)
  const Component = entries.find(e => e.options.name === 'sidebar.workspaces').component
  const list: any = { ids: ['parent', 'child'], byId: Object.fromEntries(['parent', 'child'].map(id => [id, { id, title: id, updatedAt: 1, retainedBy: {}, blank: false }])) }
  const props = { wide: true, expandSidebar: vi.fn(), useWorkspaceShortcuts: (f: any) => f({ searchRequest: 0 }), useSessions: (f: any) => f(list), useWorkspaces: (f: any) => f({ items: [], archivedSessionIds: [], pinnedSessionIds: [] }), useStore: (f: any) => f({ groupBy: 'flat', orderBy: 'updated', sessionOrderByAccount: {} }), open: vi.fn() }
  const host = document.createElement('div'); document.body.append(host)
  let root = createRoot(host)
  act(() => root.render(createElement(Component, props)))
  expect(host.querySelector('[data-sidecar-tree-session="parent"] [data-sidecar-tree-session="child"]')).not.toBeNull()
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="折叠 parent 的侧问"]')!.click())
  expect(host.querySelector('[data-sidecar-tree-session="child"]')).toBeNull()
  act(() => root.unmount()); root = createRoot(host)
  act(() => root.render(createElement(Component, props)))
  expect(host.querySelector('[data-sidecar-tree-session="child"]')).toBeNull()
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="展开 parent 的侧问"]')!.click())
  expect(host.querySelector('[data-sidecar-tree-session="child"]')).not.toBeNull()
  expect(host.textContent).not.toContain('管理')
  expect(entries.some(e => e.options.name === 'sidebar.footer.action')).toBe(true)
  act(() => root.unmount()); dispose()
  expect(controller.store.records('parent')).toHaveLength(1)
})
it('keeps a stable override when the public winner is the plugin itself', () => {
  const controller = new SidecarController()
  const native = { component: () => null, store: {}, inject: () => ({}) }
  let override: any
  let notify = () => {}
  const register = vi.fn((options: any, component: any) => {
    if (options.name !== 'sidebar.workspaces') return () => {}
    override = { component, ...options }; notify()
    return () => { override = undefined; notify() }
  })
  const ctx: any = { slots: {
    entries: () => override ? [override, native] : [native],
    entriesOfSlot: () => [override ?? native],
    subscribe: (_: string, fn: any) => { notify = fn; return () => { notify = () => {} } },
    inject: (_: string, fn: any) => fn(), register,
  } }
  const dispose = registerSessionTree(ctx, controller)
  for (let i = 0; i < 3; i++) notify()
  expect(register.mock.calls.filter(([options]) => options.name === 'sidebar.workspaces')).toHaveLength(1)
  dispose()
  expect(override).toBeUndefined()
})

it('reorders without losing hidden or archived account members and rejects missing targets', () => {
  expect(reorderSessions(['a', 'hidden', 'b', 'archived'], 'a', 'b', true)).toEqual(['hidden', 'b', 'a', 'archived'])
  expect(reorderSessions(['a', 'b'], 'a', 'missing', true)).toBeUndefined()
  expect(reorderSessions(['a', 'b'], 'a', 'b', false)).toBeUndefined()
})

function mountBrowser() {
  const controller = new SidecarController()
  controller.store.setRecords('parent', [relation('parent', 'child'), relation('parent', 'sibling')].map(r => ({ ...r, sourceKind: 'selection' })) as any)
  const list: any = { ids: ['parent', 'child', 'sibling', 'other', 'hidden'], byId: Object.fromEntries(['parent', 'child', 'sibling', 'other', 'hidden'].map(id => [id, { id, title: id, updatedAt: 1, retainedBy: {}, blank: id === 'hidden' }])) }
  const workspaces: any = { items: [], archivedSessionIds: [], pinnedSessionIds: [] }
  const view: any = { groupBy: 'flat', orderBy: 'manual', sessionOrderByAccount: { __flat_session_order__: [...list.ids] } }
  const nativeActions = { pinSession: vi.fn(async () => {}), unpinSession: vi.fn(async () => {}), archiveSession: vi.fn(async () => {}), unarchiveSession: vi.fn(async () => {}) }
  let Component: any
  const ctx: any = { uiWorkspace: nativeActions, uiSession: { adapter: { current: createSnapshotStore({ key: 'parent' }) } }, slots: {
    entries: () => [{ component: () => null, store: {}, inject: () => ({}) }], subscribe: () => () => {},
    inject: (_: string, fn: any) => fn(),
    register: (options: any, component: any) => { if (options.name === 'sidebar.workspaces') Component = component; return () => {} },
  } }
  const dispose = registerSessionTree(ctx, controller)
  const props = { wide: true, expandSidebar: vi.fn(), useWorkspaceShortcuts: (f: any) => f({ searchRequest: 0 }), useSessions: (f: any) => f(list), useWorkspaces: (f: any) => f(workspaces), useStore: (f: any) => f(view), startSession: vi.fn(), open: vi.fn(), notifyArchivedNotOpenable: vi.fn(),
    searchSessions: vi.fn(async (_q: string, _signal: AbortSignal) => ({ items: [] as any[], hasMore: false })), actions: { setSessionOrder: vi.fn(), setGroupBy: vi.fn(), setGroupExpanded: vi.fn(), setOrderBy: vi.fn(), setArchivedFilter: vi.fn() } }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const render = () => act(() => root.render(createElement(Component, props)))
  render()
  const input = (text: string) => act(() => {
    const field = host.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const row = (id: string) => host.querySelector(`[data-sidecar-tree-session="${id}"] > div`)!
  const drag = (from: string, to: string) => act(() => {
    for (const [target, name] of [[row(from), 'dragstart'], [row(to), 'dragover'], [row(to), 'drop']] as const) {
      const event = new Event(name, { bubbles: true, cancelable: true })
      Object.defineProperties(event, { dataTransfer: { value: { setData: vi.fn() } }, clientY: { value: 100 } })
      target.dispatchEvent(event)
    }
  })
  return { controller, list, host, props, nativeActions, workspaces, view, render, input, drag, close: () => { act(() => root.unmount()); dispose() } }
}
it('uses native full-text search, includes ancestors, and ignores aborted stale responses', async () => {
  vi.useFakeTimers()
  const f = mountBrowser()
  try {
    let resolveOld!: (value: any) => void
    f.props.searchSessions.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    f.input('old'); await act(async () => { await vi.advanceTimersByTimeAsync(201) })
    const oldSignal = f.props.searchSessions.mock.calls[0]![1]
    f.props.searchSessions.mockResolvedValueOnce({ items: [{ sessionId: 'child', snippet: 'only in body' }], hasMore: true })
    f.input('body'); await act(async () => { await vi.advanceTimersByTimeAsync(201) })
    expect(oldSignal.aborted).toBe(true)
    expect(f.host.querySelector('[data-sidecar-tree-session="parent"] [data-sidecar-tree-session="child"]')).not.toBeNull()
    expect(f.host.textContent).toContain('only in body')
    expect(f.host.querySelector('[data-sidecar-tree-session="other"]')).toBeNull()
    await act(async () => resolveOld({ items: [{ sessionId: 'other', snippet: 'stale' }], hasMore: false }))
    expect(f.host.textContent).not.toContain('stale')
    f.input(''); expect(f.host.querySelector('[data-sidecar-tree-session="other"]')).not.toBeNull()
  } finally { f.close(); vi.useRealTimers() }
})
it('keeps title search usable when native full-text search fails', async () => {
  vi.useFakeTimers(); const f = mountBrowser()
  try {
    f.props.searchSessions.mockRejectedValueOnce(new Error('offline'))
    f.input('child'); await act(async () => { await vi.advanceTimersByTimeAsync(201) })
    expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('全文搜索失败')
    expect(f.host.querySelector('[data-sidecar-tree-session="child"]')).not.toBeNull()
  } finally { f.close(); vi.useRealTimers() }
})
it('writes sibling drag order into the native store, retains hidden rows, rejects reparenting and pin-boundary moves', () => {
  const f = mountBrowser()
  try {
    f.drag('child', 'sibling')
    expect(f.props.actions.setSessionOrder).toHaveBeenCalledOnce()
    const [account, order, all] = f.props.actions.setSessionOrder.mock.calls[0] as any
    expect(account).toBe('__flat_session_order__')
    expect(order.indexOf('child')).toBeGreaterThan(order.indexOf('sibling'))
    expect(order).toContain('hidden'); expect(all['']).toContain('hidden')
    f.props.actions.setSessionOrder.mockClear()
    f.drag('child', 'other'); expect(f.props.actions.setSessionOrder).not.toHaveBeenCalled()
    f.workspaces.pinnedSessionIds = ['child']; f.render()
    f.drag('child', 'sibling'); expect(f.props.actions.setSessionOrder).not.toHaveBeenCalled()
    expect(f.controller.store.records('parent')).toHaveLength(2)
  } finally { f.close() }
})
it('keeps archive filtering and archived click protection in the unified list', () => {
  const f = mountBrowser()
  try {
    f.workspaces.archivedSessionIds = ['child']; f.render()
    expect(f.host.querySelector('[data-sidecar-tree-session="child"]')).toBeNull()
    f.view.archivedFilter = 'show'; f.render()
    const button = f.host.querySelector<HTMLButtonElement>('[data-sidecar-tree-session="child"] button[title="child"]')!
    act(() => button.click())
    expect(f.props.notifyArchivedNotOpenable).toHaveBeenCalledOnce(); expect(f.props.open).not.toHaveBeenCalled()
    f.view.archivedFilter = 'only'; f.render()
    expect(f.host.querySelector('[data-sidecar-tree-session="child"]')).not.toBeNull()
    expect(f.host.querySelector('[data-sidecar-tree-session="parent"]')).toBeNull()
  } finally { f.close() }
})

it('preserves pending native members before their summaries arrive during reload', () => {
  expect(workspaceOrder({ ids: [], byId: {} } as any, { items: [], pinnedSessionIds: [], archivedSessionIds: [] } as any,
    { groupBy: 'flat', orderBy: 'manual', sessionOrderByAccount: { __flat_session_order__: ['pending'] } } as any, true)).toEqual([])
  expect(workspaceOrder({ ids: ['pending'], byId: {} } as any, { items: [], pinnedSessionIds: [], archivedSessionIds: [] } as any,
    { groupBy: 'flat', orderBy: 'manual', sessionOrderByAccount: { __flat_session_order__: ['pending'] } } as any, true)).toEqual(['pending'])
})

it('treats disabled native indexing as title-only search without an error banner', async () => {
  vi.useFakeTimers(); const f = mountBrowser()
  try {
    f.props.searchSessions.mockRejectedValueOnce(new Error('session search is disabled: openAt never'))
    f.input('child'); await act(async () => { await vi.advanceTimersByTimeAsync(201) })
    expect(f.host.querySelector('[role="alert"]')).toBeNull()
    expect(f.host.querySelector('[data-sidecar-tree-session="child"]')).not.toBeNull()
  } finally { f.close(); vi.useRealTimers() }
})

it('shows native blank title instead of an old sidecar label without renaming stored data', () => {
  const f = mountBrowser()
  try {
    f.list.byId.parent.title = '新侧问'; f.list.byId.parent.blank = true; f.list.byId.parent.retainedBy = { mainView: 1 }; f.render()
    expect(f.host.querySelector('[data-sidecar-tree-session="parent"] button[title="新会话"]')).not.toBeNull()
    expect(f.list.byId.parent.title).toBe('新侧问')
    f.list.byId.parent.blank = false; f.render()
    expect(f.host.querySelector('[data-sidecar-tree-session="parent"] button[title="新侧问"]')).not.toBeNull()
  } finally { f.close() }
})
it('keeps empty workspaces actionable and starts a native session in the selected workspace', () => {
  const f = mountBrowser()
  try {
    f.view.groupBy = 'workspace'
    f.workspaces.items = [{ workspaceId: 'empty', title: 'Empty workspace', path: '/empty', sessionIds: [] }]
    f.render()
    act(() => f.host.querySelector<HTMLButtonElement>('[aria-label="在 Empty workspace 新建会话"]')!.click())
    expect(f.props.startSession).toHaveBeenCalledWith('empty')
    expect(f.props.actions.setGroupExpanded).toHaveBeenCalledWith('empty', true)
    expect(f.controller.store.records('parent')).toHaveLength(2)
  } finally { f.close() }
})
it('switches to the native slot and back, persists the preference across registration', () => {
  const native = { component: () => null, store: {}, inject: () => ({}) }
  let override: any; let Toggle: any; let notify = () => {}
  const ctx: any = { slots: {
    entries: () => override ? [override, native] : [native],
    subscribe: (_: string, fn: any) => { notify = fn; return () => { notify = () => {} } },
    inject: (_: string, fn: any) => fn(),
    register: (options: any, component: any) => {
      if (options.name === 'sidebar.footer.action') { Toggle = component; return () => {} }
      override = { component, ...options }; notify()
      return () => { override = undefined; notify() }
    },
  } }
  const controller = new SidecarController()
  let dispose = registerSessionTree(ctx, controller)
  const host = document.createElement('div'); const root = createRoot(host)
  act(() => root.render(createElement(Toggle, { wide: true })))
  act(() => host.querySelector('button')!.click())
  expect(override).toBeUndefined()
  expect(localStorage.getItem('dsh-sidecar-session-tree-v1')).toBe('false')
  dispose(); dispose = registerSessionTree(ctx, controller)
  expect(override).toBeUndefined()
  act(() => root.render(createElement(Toggle, { wide: true })))
  act(() => host.querySelector('button')!.click())
  expect(override?.component).toBeDefined()
  expect(localStorage.getItem('dsh-sidecar-session-tree-v1')).toBe('true')
  act(() => root.unmount()); dispose()
})

it('defaults to the untouched native list and registers only a hierarchy toggle', () => {
  localStorage.removeItem('dsh-sidecar-session-tree-v1')
  const register = vi.fn(() => () => {})
  const ctx: any = { slots: { register, entries: () => [], subscribe: () => () => {}, inject: (_: string, fn: any) => fn() } }
  const dispose = registerSessionTree(ctx, new SidecarController())
  expect(register.mock.calls.map((call: any) => call[0].name)).toEqual(['sidebar.footer.action'])
  dispose()
})

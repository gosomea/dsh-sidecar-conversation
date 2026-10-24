/* @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { sessionTree, registerSessionTree } from '../src/client/session-tree.js'
import { SidecarController } from '../src/client/controller.js'
import { createSnapshotStore } from './snapshot-fixture.js'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({ ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(),
  Button: ({ children, variant: _v, size: _s, ...props }: any) => createElement('button', props, children),
  Menu: ({ anchor }: any) => anchor,
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const relation = (parentSessionId: string, childSessionId: string, creationMode: 'fork' | 'independent' = 'fork') => ({ parentSessionId, childSessionId, creationMode })
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
it('renders and persists folds, offers a native list fallback, and disposes without touching session data', () => {
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
  const props = { wide: true, useSessions: (f: any) => f(list), useWorkspaces: (f: any) => f({ items: [], archivedSessionIds: [], pinnedSessionIds: [] }), useStore: (f: any) => f({ groupBy: 'flat', orderBy: 'updated', sessionOrderByAccount: {} }), open: vi.fn() }
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
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '管理')!.click())
  expect(localStorage.getItem('dsh-sidecar-session-tree-v1')).toBe('false')
  expect(stop).toHaveBeenCalled()
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

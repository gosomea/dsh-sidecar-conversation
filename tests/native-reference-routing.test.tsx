import { createSnapshotStore } from './snapshot-fixture.js'
/* @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SidecarController } from '../src/client/controller.js'
import { registerNativeSidebar } from '../src/client/native-sidebar.js'
import { draftSidecarTabMeta, sidecarTabId, SIDECAR_CHAT_TAB_TYPE } from '../src/client/tab-meta.js'
import type { Context } from '@deepseek-ai/cordis'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
// The host supplies UI primitives; this test exercises routing and native input actions.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: { children?: import('react').ReactNode }) => createElement('button', props, props.children),
  ReferenceChip: ({ label, onActivate, title }: any) => createElement(onActivate ? 'button' : 'span', { onClick: onActivate, title }, label),
  IconCloseOutlineMedium: () => null,
  IconSendOutlineMedium: () => null,
}))
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(f => f()); localStorage.clear() })
const draft = { sourceKind: 'turn' as const, sourceMessageId: 'source', sourceSeq: 3, quote: '', question: 'keep this question', accessMode: 'read-only' as const }
function setup(active = false) {
  const controller = new SidecarController()
  vi.spyOn(controller.api, 'catalog').mockResolvedValue([])
  const records: any[] = active ? [{ parentSessionId: 'parent', childSessionId: 'child', requestKey: 'b', title: 'old title', sourceKind: 'turn', status: 'active', access: { mode: 'read-only' } }] : []
  controller.store.setRecords('parent', records)
  const saved = Object.fromEntries(['a', 'b'].map((key, index) => [sidecarTabId(key), {
    id: sidecarTabId(key), type: SIDECAR_CHAT_TAB_TYPE, sessionId: 'parent', title: key, usedAt: index,
    meta: active && key === 'b' ? { version: 1, kind: 'active', parentSessionId: 'parent', requestKey: key, childSessionId: 'child' } : draftSidecarTabMeta('parent', key, draft),
  }]))
  localStorage.setItem('dsh-sidecar-native-tabs-v1', JSON.stringify(saved))
  const entries: any[] = []
  const insertReference = vi.fn(() => true)
  const input = { insertReference, focus: vi.fn() }
  const ctx: any = {
    uiWorkspace: { sessionOrder: createSnapshotStore<readonly string[]>([]) },
    get: () => ({ registerSource: () => () => {} }),
    uiConversation: { userText: { register: () => () => {} } },
    sessions: { list: createSnapshotStore<any>({ ids: [], byId: {} }), using: async (_id: string, _options: unknown, f: any) => f({ ready: Promise.resolve({ ctx: {} }) }) },
    conversation: { input: { for: () => input } },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { mounted: { getSnapshot: () => 'parent' }, openResourceIn: vi.fn(), openTabIn: vi.fn(), tabsIn: () => active ? [{ contentId: 'dsh-resource://sidecar/' + encodeURIComponent(sidecarTabId('b')) }] : [], closeIn: vi.fn() },
    slots: { inject: (_: string, f: any) => f(), register: (options: any, component: any) => { entries.push({ options, component }); return () => {} } },
  }
  cleanup.push(registerNativeSidebar(ctx as Context, controller))
  return { controller, ctx, entries, insertReference }
}
it('omits recent target when only saved or unfinished drafts exist', () => {
  const f = setup()
  expect(f.controller.recentTarget!('parent')).toBeUndefined()
})
it('only offers an open active child of the current parent', () => {
  const f = setup(true)
  expect(f.controller.recentTarget!('parent')?.id).toBe(sidecarTabId('b'))
  expect(f.controller.recentTarget!('other-parent')).toBeUndefined()
  f.ctx.sidebarRight.tabsIn = () => []
  expect(f.controller.recentTarget!('parent')).toBeUndefined()
})
it('uses native insertion coordinates and persistence when appending to an existing Session', async () => {
  const f = setup(true)
  const component = f.entries.find(e => e.options.name === 'sidecar.conversation').component
  const actions = { captureInsertion: vi.fn(() => ({ start: 2, end: 2, draftRev: 7 })), persistDraft: vi.fn() }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(component, { sessionId: 'child', inputActions: actions, useSession: (read: any) => read({ running: false }), renderFactorySlot: () => null })))
  cleanup.unshift(() => act(() => root.unmount()))
  await f.controller.referenceTarget!('parent', draft)
  expect(f.insertReference).toHaveBeenCalledWith(expect.objectContaining({ source: 'sidecar-reference' }), { start: 2, end: 2, draftRev: 7 })
  expect(actions.persistDraft).toHaveBeenCalledOnce()
})
it('does not silently create or redirect when the explicitly displayed target disappears', async () => {
  const f = setup()
  await expect(f.controller.referenceTarget!('parent', draft, 'missing-tab')).rejects.toThrow('目标侧问已不可用')
  expect(f.ctx.sidebarRight.openResourceIn).not.toHaveBeenCalled()
})

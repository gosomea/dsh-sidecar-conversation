import { SidecarClientStore } from '../src/client/store.js'
/* @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNativeSidebar } from '../src/client/native-sidebar.js'
import type { Context } from '@deepseek-ai/cordis'
import type { SidecarController } from '../src/client/controller.js'

vi.mock('../src/client/components/SidecarTabs.js', () => ({
  SidecarHistoryTab: () => null,
  SidecarChatTab: ({ renderConversation }: any) => renderConversation({ childSessionId: 'child' }),
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const cleanup: Array<() => void> = []
afterEach(() => { for (const f of cleanup.splice(0)) f(); localStorage.clear() })
function fixture(failure = false) {
  const entries: Array<{ options: any; component: any }> = []
  const release = vi.fn()
  const reference = { sessionId: 'child', release, ready: failure ? Promise.reject(new Error('history unavailable')) : Promise.resolve({}) }
  const retain = vi.fn(() => reference)
  const unregister = vi.fn()
  let service: any
  const ctx = {
    get: () => ({ registerSource: vi.fn(() => vi.fn()) }),
    uiConversation: { userText: { register: vi.fn(() => vi.fn()) } },
    sessions: { retain },
    sidebarRightTabs: { register: vi.fn(() => unregister) },
    sidebarRight: { mounted: { getSnapshot: () => 'parent' }, openResourceIn: vi.fn(), openTabIn: vi.fn(), tabsIn: () => [], closeIn: vi.fn() },
    slots: { inject: (_: string, f: () => any) => f(), register: (options: any, component: any) => { entries.push({ options, component }); return vi.fn() } },
  }
  const controller = { targetsChanged: vi.fn(), store: new SidecarClientStore(), bindSidebar: (s: any) => { service = s; return vi.fn() } }
  const dispose = registerNativeSidebar(ctx as unknown as Context, controller as unknown as SidecarController)
  cleanup.push(dispose)
  return { ctx, entries, retain, release, reference, service, unregister, dispose }
}
function mount(f: ReturnType<typeof fixture>) {
  f.service.openTab({ id: 'draft', type: 'dsh-sidecar-conversation:chat', title: 'sidecar', meta: {} }, { sessionId: 'parent' })
  const Body = f.entries.find(x => x.options.key === 'dsh-sidecar-conversation:chat')!.component
  const Provider = vi.fn(({ children }: any) => children)
  const renderSlot = vi.fn(() => createElement('div', null, 'native content'))
  const el = document.createElement('div'); document.body.append(el)
  const root = createRoot(el)
  cleanup.unshift(() => { act(() => root.unmount()); el.remove() })
  act(() => root.render(createElement(Body, { sessionId: 'parent', SessionProvider: Provider, renderSlot, useProjection: () => undefined, useSession: (read: any) => read({ running: false }),
    useTabInfo: () => ({ tab: { id: 'tab', kind: 'dsh-sidecar-conversation:chat', contentId: 'dsh-resource://sidecar/draft', visible: true } }) })))
  return { Provider, renderSlot, el, root }
}
describe('native sidebar conversation ownership', () => {
  it('registers one Session child seat and the native embedded factory', () => {
    const f = fixture()
    expect(f.entries.filter(x => x.options.children?.['sidecar.conversation'])).toHaveLength(1)
    const component = f.entries.find(x => x.options.name === 'sidecar.conversation')!.component
    const renderFactorySlot = vi.fn()
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(component, { renderFactorySlot, sessionId: 'child', inputActions: {}, useSession: (read: any) => read({ running: false }) })))
    cleanup.unshift(() => act(() => root.unmount()))
    expect(renderFactorySlot).toHaveBeenCalledWith('conversation.content', { variant: 'embedded', phase: 'active', hero: false })
  })
  it('retains the child and renders its explicit reference without selecting the parent', async () => {
    const f = fixture(); const view = mount(f)
    await act(async () => { await Promise.resolve() })
    expect(f.retain).toHaveBeenCalledWith('child', { source: 'sidecarView' })
    expect(view.Provider.mock.calls.at(-1)![0].session).toBe(f.reference)
    expect(view.el.textContent).toContain('native content')
  })
  it('releases its Session reference on unmount', () => {
    const f = fixture(); const view = mount(f)
    act(() => view.root.unmount())
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('shows a real history acquisition error instead of fabricated content', async () => {
    const f = fixture(true); const view = mount(f)
    await act(async () => { await Promise.resolve() })
    expect(view.el.querySelector('[role=alert]')?.textContent).toContain('history unavailable')
  })
  it('opens in the parent native dock and disposes both tab types', () => {
    const f = fixture()
    f.service.openTab({ id: 'stable', type: 'dsh-sidecar-conversation:chat' }, { sessionId: 'parent' })
    expect(f.ctx.sidebarRight.openResourceIn).toHaveBeenCalledWith('parent', 'dsh-resource://sidecar/stable', { kind: 'dsh-sidecar-conversation:chat' })
    f.dispose(); cleanup.pop()
    expect(f.unregister).toHaveBeenCalledTimes(2)
  })
})

it('updates the native tab title when a draft question changes', () => {
  const f = fixture()
  act(() => f.service.openTab({ id: 'draft', type: 'dsh-sidecar-conversation:chat', title: 'First question' }, { sessionId: 'parent' }))
  const Title = f.entries.find(x => x.options.name === 'sidebar.right.pane.tab.title')!.component
  const el = document.createElement('div'); const root = createRoot(el)
  cleanup.unshift(() => act(() => root.unmount()))
  act(() => root.render(createElement(Title, { useTabInfo: () => ({ tab: { contentId: 'dsh-resource://sidecar/draft' } }) })))
  expect(el.textContent).toBe('First question')
  act(() => f.service.updateTab('draft', { title: '↳ 侧问 · Revised question' }))
  expect(el.textContent).toBe('Revised question')
})

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ ReferenceChip: () => null }))

it('restores legacy tabs as metadata without opening or focusing a native pane', () => {
  const f = fixture()
  f.service.restoreTab({ id: 'legacy', type: 'dsh-sidecar-conversation:chat', title: 'old' }, { sessionId: 'parent' })
  expect(f.ctx.sidebarRight.openResourceIn).not.toHaveBeenCalled()
  expect(f.ctx.sidebarRight.openTabIn).not.toHaveBeenCalled()
  expect(JSON.parse(localStorage.getItem('dsh-sidecar-native-tabs-v1')!).legacy.title).toBe('old')
})

/* @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SidecarAction } from '../src/client/components/SidecarAction.js'
import { SidecarController } from '../src/client/controller.js'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({ ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(),
  IconNewChatOutlineMedium: () => null,
  Tooltip: ({ children }: any) => children,
  Menu: ({ anchor, open, items, onSelect }: any) => createElement('div', null, anchor,
    open && createElement('div', { role: 'menu' }, items.map((item: any) => createElement('button', { key: item.id, role: 'menuitem', onClick: () => onSelect(item.id) }, item.label)))),
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).forEach(f => f()))
function fixture(target = false) {
  const controller = new SidecarController(); controller.store.setSidebarAvailable(true)
  controller.recentTarget = () => target ? { id: 'recent', title: 'recent' } : undefined
  vi.spyOn(controller, 'load').mockResolvedValue()
  const append = vi.spyOn(controller, 'addSource').mockImplementation(() => {})
  const create = vi.spyOn(controller, 'openDraft').mockImplementation(() => {})
  const el = document.createElement('div'); const root = createRoot(el)
  cleanup.push(() => act(() => root.unmount()))
  act(() => root.render(createElement(SidecarAction, { controller, messageId: 'answer-1', sessionId: 'parent', sourceSeq: 19, text: 'answer', useChat: () => ({}) } as any)))
  const open = () => act(() => el.querySelector<HTMLButtonElement>('[aria-label="侧问这个回合"]')!.click())
  return { el, open, append, create }
}
it.each([false, true])('opens a two/three action menu instead of silently choosing a route (target=%s)', target => {
  const f = fixture(target); f.open()
  expect([...f.el.querySelectorAll('[role=menuitem]')].map(item => item.textContent)).toEqual([...(target ? ['追加到最近侧问'] : []), '从此回合 Fork', '仅用此回合新建'])
  expect(f.append).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled()
})
it.each(['fork', 'independent'] as const)('confirms %s before opening a fresh turn draft', mode => {
  const f = fixture(true); f.open()
  const items = [...f.el.querySelectorAll<HTMLButtonElement>('[role=menuitem]')]
  act(() => items[mode === 'fork' ? 1 : 2]!.click())
  expect(f.create).toHaveBeenCalledWith('parent', expect.objectContaining({ sourceKind: 'turn', sourceMessageId: 'answer-1', sourceSeq: 19, quote: '', creationMode: mode, creationConfirmed: true }))
  expect(f.append).not.toHaveBeenCalled(); expect(f.el.querySelector('[role=menu]')).toBeNull()
})
it('appends the turn to the explicitly offered target only when selected', () => {
  const f = fixture(true); f.open()
  act(() => f.el.querySelector<HTMLButtonElement>('[role=menuitem]')!.click())
  expect(f.append).toHaveBeenCalledWith('parent', expect.objectContaining({ sourceKind: 'turn', sourceSeq: 19 }), 'recent')
  expect(f.create).not.toHaveBeenCalled()
})

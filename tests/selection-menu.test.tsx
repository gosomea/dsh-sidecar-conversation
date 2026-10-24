/* @vitest-environment jsdom */
import { act, createElement, forwardRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SelectionOverlay } from '../src/client/components/SelectionOverlay.js'
import { SidecarController } from '../src/client/controller.js'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({ ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(), MenuSurface: forwardRef<HTMLDivElement, any>(({ compact: _c, ...props }, ref) => createElement('div', { ...props, ref })), Button: ({ variant: _v, size: _s, ...props }: any) => createElement('button', props) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); document.body.innerHTML = '' })
function setup(hasTarget = true) {
  document.body.innerHTML = '<div data-chat-flow-kind="assistant-step">old selected turn</div><div id="menu"></div>'
  const row = document.querySelector('div')!
  const controller = new SidecarController(); controller.store.setSidebarAvailable(true)
  controller.recentTarget = () => hasTarget ? { id: 'latest', title: 'existing question' } : undefined
  vi.spyOn(controller, 'selectedSource').mockReturnValue({ parentSessionId: 'parent', candidate: { marker: row, messageId: 'old-message', sourceSeq: 19, text: row.textContent! } })
  const open = vi.spyOn(controller, 'openDraft').mockImplementation(() => {})
  const append = vi.spyOn(controller, 'addSource').mockImplementation(() => {})
  const main = vi.spyOn(controller, 'addToMain').mockImplementation(() => {})
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { fn(0); return 1 })
  Range.prototype.getBoundingClientRect = () => ({ left: 50, width: 80, bottom: 80 } as DOMRect)
  const root = createRoot(document.getElementById('menu')!)
  act(() => root.render(createElement(SelectionOverlay, { controller } as never)))
  const range = document.createRange(); range.selectNodeContents(row)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })))
  cleanup.push(() => act(() => root.unmount()))
  return { open, append, main, buttons: [...document.querySelectorAll('button')] }
}
it('shows only action labels and appends a frozen selection to the current target', () => {
  const f = setup(); expect(f.buttons).toHaveLength(4); expect(f.buttons.map(b => b.textContent?.trim())).toEqual(['追加到最近侧问', '从此回合 Fork', '仅用选文新建', '添加到主会话']); expect(document.querySelector('small')).toBeNull()
  window.getSelection()!.removeAllRanges()
  act(() => f.buttons[0]!.click())
  expect(f.append).toHaveBeenCalledWith('parent', expect.objectContaining({ sourceSeq: 19, quote: 'old selected turn' }), 'latest')
  expect(f.open).not.toHaveBeenCalled()
})
it('always starts a fresh fork from the selected historical turn with its quote attached', () => {
  const f = setup(); act(() => f.buttons[1]!.click())
  expect(f.open).toHaveBeenCalledWith('parent', expect.objectContaining({ sourceMessageId: 'old-message', sourceSeq: 19, sourceKind: 'selection', quote: 'old selected turn', creationMode: 'fork', accessMode: 'read-only' }))
  expect(f.append).not.toHaveBeenCalled()
})
it('omits append when no sidecar exists and leaves new-from-turn available', () => {
  const f = setup(false); expect(f.buttons).toHaveLength(3); expect(f.buttons[0]!.textContent?.trim()).toBe('从此回合 Fork'); expect(f.buttons[0]!.disabled).toBe(false)
})

it('starts an independent session directly from only the current selection', () => {
  const f = setup(false); act(() => f.buttons[1]!.click())
  expect(f.open).toHaveBeenCalledWith('parent', expect.objectContaining({ creationMode: 'independent', creationConfirmed: true, quote: 'old selected turn' }))
  expect(f.append).not.toHaveBeenCalled()
})

it('adds the frozen selection to its main Session without creating or appending a sidecar', () => {
  const f = setup(false)
  window.getSelection()!.removeAllRanges()
  act(() => f.buttons.at(-1)!.click())
  expect(f.main).toHaveBeenCalledWith('parent', expect.objectContaining({ sourceMessageId: 'old-message', sourceSeq: 19, quote: 'old selected turn', sourceOffset: 0 }))
  expect(f.open).not.toHaveBeenCalled()
  expect(f.append).not.toHaveBeenCalled()
})

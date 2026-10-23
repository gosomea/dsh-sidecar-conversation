/* @vitest-environment jsdom */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { revealReference } from '../src/client/references.js'
import { SidecarController } from '../src/client/controller.js'
it('uses native history paging then highlights the exact repeated source occurrence', async () => {
  document.body.innerHTML = ''
  const scrollIntoView = vi.fn(); const animate = vi.fn()
  HTMLElement.prototype.scrollIntoView = scrollIntoView
  HTMLElement.prototype.animate = animate
  const loadThrough = vi.fn(async () => {
    document.body.innerHTML = '<div data-chat-flow-kind="assistant-step"><p>same text same text</p></div><div data-chat-flow-kind="turn-tail"><button data-sidecar-assistant-marker data-sidecar-session-id="parent" data-sidecar-message-id="message"></button></div>'
  })
  const openSession = vi.fn()
  const ctx = { uiWorkspace: { openSession }, sessions: { using: async (_id: unknown, _opts: unknown, run: any) => run({ ready: Promise.resolve({ session: { loadThrough } }) }) } } as unknown as Context
  await revealReference(ctx, { parentSessionId: 'parent', sourceMessageId: 'message', sourceSeq: 12, sourceKind: 'selection', quote: 'same text', textOffset: 10 })
  expect(loadThrough).toHaveBeenCalledWith(12)
  expect(openSession).toHaveBeenCalledWith('parent')
  expect(window.getSelection()?.anchorOffset).toBe(10)
  expect(window.getSelection()?.toString()).toBe('same text')
  expect(scrollIntoView).toHaveBeenCalled()
  expect(animate).toHaveBeenCalled()
  document.body.innerHTML = ''
})
it('derives selection identity from the mounted native main message, excluding embedded sidecars', () => {
  document.body.innerHTML = '<div data-chat-flow-kind="assistant-step">selected</div><button data-sidecar-assistant-marker data-sidecar-session-id="parent" data-sidecar-message-id="message" data-sidecar-source-seq="12"></button>'
  const row = document.querySelector('div')!
  Object.defineProperty(row, 'innerText', { value: 'selected' })
  const controller = new SidecarController()
  expect(controller.selectedSource('selected', row)?.parentSessionId).toBe('parent')
  expect(controller.selectedSource('foreign', row)).toBeUndefined()
  document.body.innerHTML = ''
})
it('maps selection layout whitespace back to Markdown text nodes', async () => {
  document.body.innerHTML = '<div data-chat-flow-kind="assistant-step"><p>first <strong>block</strong></p><p>second block</p></div><button data-sidecar-assistant-marker data-sidecar-session-id="parent" data-sidecar-message-id="message"></button>'
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.animate = vi.fn()
  const ctx = { uiWorkspace: { openSession: vi.fn() }, sessions: { using: async (_id: unknown, _opts: unknown, run: any) => run({ ready: Promise.resolve({ session: { loadThrough: vi.fn() } }) }) } } as unknown as Context
  await revealReference(ctx, { parentSessionId: 'parent', sourceMessageId: 'message', sourceSeq: 12, sourceKind: 'selection', quote: 'first block\n\nsecond block' })
  expect(window.getSelection()?.toString()).toBe('first blocksecond block')
  document.body.innerHTML = ''
})

it('pages a native turn and highlights only the main-session turn, including an unanswered turn', async () => {
  const { revealTurn } = await import('../src/client/references.js')
  document.body.innerHTML = '<div data-sidecar-native-surface><div data-chat-turn="2" data-chat-flow-kind="user">child</div></div><div data-chat-turn="2" data-chat-flow-kind="user">parent question</div>'
  HTMLElement.prototype.getClientRects = () => [{ width: 10 }] as unknown as DOMRectList
  HTMLElement.prototype.scrollIntoView = vi.fn(); HTMLElement.prototype.animate = vi.fn()
  const loadThrough = vi.fn()
  const ctx = { uiWorkspace: { openSession: vi.fn() }, uiSession: { adapter: { current: { getSnapshot: () => ({ key: 'parent' }) } } }, sessions: { using: async (_id: unknown, _opts: unknown, run: any) => run({ ready: Promise.resolve({ session: { loadThrough } }) }) } } as unknown as Context
  await revealTurn(ctx, 'parent', { turn: 2, seq: 20 })
  expect(loadThrough).toHaveBeenCalledWith(20)
  expect(document.querySelector('[data-sidecar-turn-highlight]')?.textContent).toBe('parent question')
  document.body.innerHTML = ''
})

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ ReferenceChip: () => null }))

it('never binds a selected row to another conversation surface', () => {
  document.body.innerHTML = '<div data-conversation-session="parent-a"><p id="source">selected text</p></div><div data-conversation-session="parent-b"><button data-sidecar-assistant-marker data-sidecar-session-id="parent-b" data-sidecar-message-id="other" data-sidecar-source-seq="3"></button></div>'
  const row = document.getElementById('source')!
  Object.defineProperty(row, 'innerText', { value: 'selected text' })
  const controller = new SidecarController()
  expect(controller.selectedSource('selected text', row)).toBeUndefined()
  row.insertAdjacentHTML('afterend', '<button data-sidecar-assistant-marker data-sidecar-session-id="parent-a" data-sidecar-message-id="same" data-sidecar-source-seq="8"></button>')
  expect(controller.selectedSource('selected text', row)?.parentSessionId).toBe('parent-a')
})

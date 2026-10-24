/* @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { revealReference, revealTurn } from '../src/client/references.js'
import { createSourceHighlighter, sourceRange } from '../src/client/source-highlight.js'
import { SidecarController } from '../src/client/controller.js'

let highlights: Map<string, Set<Range>>
let animate: ReturnType<typeof vi.fn>
let scroll: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  highlights = new Map()
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', class extends Set<Range> { constructor(...ranges: Range[]) { super(ranges) } })
  animate = vi.fn(() => ({ cancel: vi.fn() })); scroll = vi.fn()
  HTMLElement.prototype.animate = animate
  HTMLElement.prototype.scrollIntoView = scroll
  HTMLElement.prototype.getClientRects = () => [{ width: 10 }] as unknown as DOMRectList
  document.body.innerHTML = ''
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); window.getSelection()?.removeAllRanges(); document.body.innerHTML = '' })
const reference = { parentSessionId: 'parent', sourceMessageId: 'message', sourceSeq: 12, sourceKind: 'selection' as const, quote: 'same text', textOffset: 10 }
const marker = '<button data-sidecar-assistant-marker data-sidecar-session-id="parent" data-sidecar-message-id="message"></button>'
function fixture(html?: string) {
  const loadThrough = vi.fn(async () => { if (html !== undefined) document.body.innerHTML = html })
  const openSession = vi.fn()
  const ctx = { uiWorkspace: { openSession }, uiSession: { adapter: { current: { getSnapshot: () => ({ key: 'parent' }) } } }, sessions: { using: async (_id: unknown, _opts: unknown, run: any) => run({ ready: Promise.resolve({ session: { loadThrough } }) }) } } as unknown as Context
  return { ctx, loadThrough, openSession }
}
function highlightedRange() { return [...highlights.get('dsh-sidecar-reference')!][0]! }

it('pages history and highlights only the exact repeated source occurrence', async () => {
  const f = fixture('<div data-chat-flow-kind="assistant-step"><p>same text same text</p></div>'+marker)
  await revealReference(f.ctx, reference)
  expect(f.loadThrough).toHaveBeenCalledWith(12); expect(f.openSession).toHaveBeenCalledWith('parent')
  expect(highlightedRange().startOffset).toBe(10)
  expect(highlightedRange().toString()).toBe('same text')
  expect(animate).not.toHaveBeenCalled()
  expect(document.querySelector('[data-sidecar-turn-highlight]')).toBeNull()
})
it('keeps the right editor selection and focus while the source range stays highlighted', async () => {
  document.body.innerHTML = '<div data-chat-flow-kind="assistant-step">same text same text</div>'+marker+'<div contenteditable="true" id="editor">draft</div>'
  const editor = document.getElementById('editor')!; editor.focus()
  const selection = document.createRange(); selection.selectNodeContents(editor)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(selection)
  expect(window.getSelection()!.toString()).toBe('draft')
  await revealReference(fixture().ctx, reference)
  expect(document.activeElement).toBe(editor)
  expect(window.getSelection()!.toString()).toBe('draft')
  expect(highlightedRange().toString()).toBe('same text')
  await vi.advanceTimersByTimeAsync(3000)
  expect(highlights.size).toBe(0)
})
it('maps cross-paragraph Markdown whitespace to exact text nodes', async () => {
  const f = fixture('<div data-chat-flow-kind="assistant-step"><p>first <strong>block</strong></p><p>second block</p></div>'+marker)
  await revealReference(f.ctx, { ...reference, quote: 'first block\n\nsecond block', textOffset: 0 })
  expect(highlightedRange().toString()).toBe('first blocksecond block')
  expect(animate).not.toHaveBeenCalled()
})
it.each(['same text', 'missing quote'])('rejects an unresolvable quote %s without flashing the whole message', async quote => {
  const f = fixture('<div data-chat-flow-kind="assistant-step">same text same text</div>'+marker)
  const result = revealReference(f.ctx, { ...reference, quote, textOffset: undefined } as never)
  const assertion = expect(result).rejects.toThrow(/唯一定位/)
  await vi.advanceTimersByTimeAsync(10000); await assertion
  expect(highlights.size).toBe(0); expect(animate).not.toHaveBeenCalled()
})
it('uses the main Session surface even if another surface has identical text', async () => {
  const f = fixture('<div data-conversation-session="other"><div data-chat-flow-kind="assistant-step">same text same text</div></div><div data-conversation-session="parent"><div data-chat-flow-kind="assistant-step">same text same text</div>'+marker+'</div>')
  await revealReference(f.ctx, reference)
  expect(highlightedRange().startContainer.parentElement!.closest('[data-conversation-session]')?.getAttribute('data-conversation-session')).toBe('parent')
})
it('highlights the main turn for turn references, excluding embedded sidecars', async () => {
  const f = fixture('<div data-sidecar-native-surface><div data-chat-turn="2">child</div></div><div data-conversation-session="parent"><div data-chat-turn="2" data-chat-flow-kind="user">parent question</div><div data-chat-turn="2" data-chat-flow-kind="assistant-step">answer</div>'+marker+'</div>')
  await revealReference(f.ctx, { ...reference, sourceKind: 'turn', quote: '' })
  expect([...document.querySelectorAll('[data-sidecar-turn-highlight]')].map(e => e.textContent)).toEqual(['parent question', 'answer'])
  expect(animate).toHaveBeenCalledTimes(2); expect(highlights.size).toBe(0)
})
it('pages and highlights an unanswered turn with native history loading', async () => {
  const f = fixture('<div data-chat-turn="2" data-chat-flow-kind="user">parent question</div>')
  // Rendering the row follows the native history response.
  await f.loadThrough()
  await revealTurn(f.ctx, 'parent', { turn: 2, seq: 20 })
  expect(f.loadThrough).toHaveBeenCalledWith(20)
  expect(document.querySelector('[data-sidecar-turn-highlight]')?.textContent).toBe('parent question')
})
it('replaces an earlier turn flash and clears its timer on disposal', () => {
  document.body.innerHTML = '<p data-chat-turn="1">same text</p>'
  const highlighter = createSourceHighlighter(); const row = document.querySelector('p')!
  highlighter.turn([row]); const animation = animate.mock.results[0]!.value
  highlighter.selection(sourceRange(row, 'same text')!, row)
  expect(animation.cancel).toHaveBeenCalledOnce(); expect(row.dataset.sidecarTurnHighlight).toBeUndefined()
  highlighter.clear(); expect(highlights.size).toBe(0); expect(vi.getTimerCount()).toBe(0)
})
it('matches normalized repeated text using the captured DOM offset', () => {
  document.body.innerHTML = '<p>same  text same  text</p>'
  const range = sourceRange(document.querySelector('p')!, 'same text', 11)!
  expect(range.startOffset).toBe(11); expect(range.toString()).toBe('same  text')
})
it('cleans up the geometric fallback without modifying native message content', () => {
  vi.stubGlobal('CSS', {})
  document.body.innerHTML = '<p>same text</p>'
  const row = document.querySelector('p')!, range = sourceRange(row, 'same text')!
  range.getClientRects = () => [{ left: 10, top: 20, width: 80, height: 18 }] as unknown as DOMRectList
  const before = row.innerHTML, highlighter = createSourceHighlighter()
  highlighter.selection(range, row)
  const mark = document.querySelector<HTMLElement>('.dsh-sidecar-reference-overlay span')!
  expect(mark.style.width).toBe('80px')
  expect(row.innerHTML).toBe(before)
  highlighter.clear()
  expect(document.querySelector('.dsh-sidecar-reference-overlay')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
it('derives selection identity from the mounted main message only', () => {
  document.body.innerHTML = '<div data-conversation-session="parent-a"><p id="source">selected text</p></div><div data-conversation-session="parent-b"><button data-sidecar-assistant-marker data-sidecar-session-id="parent-b" data-sidecar-message-id="other" data-sidecar-source-seq="3"></button></div>'
  const row = document.getElementById('source')!
  Object.defineProperty(row, 'innerText', { value: 'selected text' })
  const controller = new SidecarController()
  expect(controller.selectedSource('selected text', row)).toBeUndefined()
  row.insertAdjacentHTML('afterend', '<button data-sidecar-assistant-marker data-sidecar-session-id="parent-a" data-sidecar-message-id="same" data-sidecar-source-seq="8"></button>')
  expect(controller.selectedSource('selected text', row)?.parentSessionId).toBe('parent-a')
})
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({ ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(), ReferenceChip: () => null }))

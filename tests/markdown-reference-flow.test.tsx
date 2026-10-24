/* @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { SidecarController } from '../src/client/controller.js'
import { SelectionOverlay } from '../src/client/components/SelectionOverlay.js'
import { registerReferences, referenceRule } from '../src/client/references.js'
import { sourceRange } from '../src/client/source-highlight.js'
import type { SidecarDraft } from '../src/core/types.js'
import type { SidecarReference } from '../src/core/references.js'
import { fixture } from './service-fixture.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const cleanup: Array<() => void> = []
afterEach(() => {
  cleanup.splice(0).forEach(fn => fn())
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  window.getSelection()?.removeAllRanges(); document.body.innerHTML = ''
})

const cases = [
  { name: 'table across rows/cells', markdown: '| 状态 | 说明 |\n| --- | --- |\n| 完成 | **A &amp; B** |', selected: '状态\t说明\n完成\tA & B' },
  { name: 'formatted paragraph with an entity', markdown: '解释 **A &amp; B**，再看 `count = 2`。', selected: '解释 A & B，再看 count = 2。' },
  { name: 'link containing nested parentheses', markdown: '[工作区](https://example.com/a_(b)) 后续操作。', selected: '工作区 后续操作。' },
  { name: 'selection across nested Markdown blocks', markdown: '> **第一段**\n>\n> 第二段 `code`', selected: '第一段\n\n第二段 code' },
]

it.each(cases)('selects, forks, navigates and serializes native Markdown: $name', async ({ markdown, selected }) => {
  const f = await fixture({ sourceText: markdown })
  const controller = new SidecarController()
  const openTab = vi.fn(), updateTab = vi.fn()
  cleanup.push(controller.bindSidebar({ openTab, updateTab, activateTab: vi.fn() } as never))
  vi.spyOn(controller, 'load').mockResolvedValue()
  const prepare = vi.spyOn(controller.api, 'prepare').mockImplementation(input => f.service.prepare(input))
  vi.spyOn(controller.api, 'serializeReference').mockImplementation(ref => f.service.serializeReference(ref))
  const highlights = new Map<string, Set<Range>>()
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', class extends Set<Range> { constructor(...ranges: Range[]) { super(ranges) } })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { fn(0); return 1 })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  Range.prototype.getBoundingClientRect = () => ({ left: 50, width: 80, top: 40, bottom: 80 } as DOMRect)
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList

  const main = document.createElement('div'); main.dataset.conversationSession = 'parent'
  const row = document.createElement('div'); row.dataset.chatFlowKind = 'assistant-step'
  main.append(row)
  const marker = document.createElement('button')
  Object.assign(marker.dataset, { sidecarAssistantMarker: '', sidecarSessionId: 'parent', sidecarMessageId: 'assistant-1', sidecarSourceSeq: '7' })
  main.append(marker); document.body.append(main)
  const root = createRoot(row)
  cleanup.push(() => act(() => root.unmount()))
  act(() => root.render(createElement(MarkdownText, { text: markdown, labels: { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' } })))
  const range = sourceRange(row, selected)!
  expect(range).toBeDefined()
  // jsdom has no layout selection serialization: supply browser block/cell separators.
  const selection = window.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  vi.spyOn(selection, 'toString').mockReturnValue(selected)
  Object.defineProperty(row, 'innerText', { configurable: true, get: () => selected })
  const overlay = document.createElement('div'); document.body.append(overlay)
  const menu = createRoot(overlay); cleanup.push(() => act(() => menu.unmount()))
  act(() => menu.render(createElement(SelectionOverlay, { controller } as never)))
  act(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })))
  const fork = [...document.querySelectorAll('button')].find(button => button.textContent === '从此回合 Fork')!
  expect(fork).toBeDefined()
  act(() => fork.click())
  const tab = openTab.mock.calls.at(-1)![0]
  cleanup.pop(); act(() => menu.unmount())
  const draft = tab.meta.draft as SidecarDraft
  expect(draft).toMatchObject({ sourceKind: 'selection', sourceMessageId: 'assistant-1', creationMode: 'fork', quote: selected })

  await act(async () => { await controller.prepare('parent', tab.meta.requestKey, draft) })
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: 'selection', quote: selected }))
  expect(f.forkSeqs).toEqual([7]); expect(f.counts().prompts).toBe(0)
  expect(updateTab.mock.calls.at(-1)![1].meta.initialDraft.quote).toBe(selected)
  const ref = draft.references![0]!
  let codec: { serialize: (value: string) => Promise<string> } | undefined
  let openReference: (session: unknown, value: { ref: string }) => boolean
  const ctx = {
    get: () => ({ registerSource: (source: any) => { codec = source.codec; openReference = source.openReference; return () => {} } }),
    uiConversation: { userText: { register: () => () => {} } },
    uiWorkspace: { openSession: vi.fn() },
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: 'parent' }) } } },
    sessions: { using: async (_id: unknown, _options: unknown, run: any) => run({ ready: Promise.resolve({ session: { loadThrough: vi.fn() } }) }) },
    slots: { inject: (_name: string, register: () => unknown) => register(), register: () => () => {} },
  } as unknown as Context
  const dispose = registerReferences(ctx, controller); cleanup.unshift(dispose)
  const jump = vi.spyOn(controller, 'jumpToSource')
  // Exercise the same native reference-open callback used by a draft chip.
  await act(async () => { expect(openReference!(null, { ref: JSON.stringify(ref) })).toBe(true) })
  await vi.waitFor(() => expect(highlights.size).toBe(1))
  expect([...highlights.values()][0]!.values().next().value!.toString().replace(/\s/g, '')).toBe(selected.replace(/\s/g, ''))
  expect(document.querySelector('[data-sidecar-turn-highlight]')).toBeNull()

  const wire = await codec!.serialize(JSON.stringify(ref))
  const parsed = referenceRule.match(wire, 0)!
  expect(parsed.data).toMatchObject({ parentSessionId: 'parent', sourceMessageId: 'assistant-1', sourceSeq: 7, quote: selected })
  // Native composer submission owns the user/message. The service must serialize
  // the reference before that submission and never send a second plugin prompt.
  expect(wire).toContain(JSON.stringify(selected).slice(1, -1))
  const historyReference = parsed.data as SidecarReference
  await act(async () => { expect(openReference!(null, { ref: JSON.stringify(historyReference) })).toBe(true) })
  await vi.waitFor(() => expect(jump).toHaveBeenCalledTimes(2))
  expect(f.counts().prompts).toBe(0)
  await expect(codec!.serialize(JSON.stringify({ ...ref, quote: selected + '伪造内容' }))).rejects.toThrow('请移除')
  await expect(codec!.serialize(JSON.stringify({ ...ref, sourceMessageId: 'foreign-message' }))).rejects.toThrow('找不到')
})

it('rejects an invalid selection before creating a Fork', async () => {
  const f = await fixture({ sourceText: '**真实正文**' })
  const controller = new SidecarController()
  vi.spyOn(controller.api, 'prepare').mockImplementation(input => f.service.prepare(input))
  await expect(controller.prepare('parent', 'bad-source', {
    sourceKind: 'selection', sourceMessageId: 'assistant-1', sourceSeq: 7,
    quote: '别处的文字', question: '', accessMode: 'read-only', creationMode: 'fork',
  })).rejects.toThrow('不一致')
  expect(f.counts().forks).toBe(0)
})

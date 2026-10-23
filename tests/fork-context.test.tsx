/* @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ForkContext, forkProgress } from '../src/client/components/ForkContext.js'
import { SidecarController } from '../src/client/controller.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const outline = [1, 2, 3].map(turn => ({ turn, seq: (turn * 10) as SessionSeq, prompt: `question ${turn}`, response: '' }))
it('uses native started turn boundaries, not event distance or local message count', () => {
  expect(forkProgress(outline, 19)).toMatchObject({ source: { turn: 1 }, firstNew: { turn: 2 }, latest: { turn: 3 }, count: 2 })
  expect(forkProgress(outline, 30)?.count).toBe(0)
  expect(forkProgress(undefined, 19)).toBeUndefined()
  expect(forkProgress([], 19)).toBeUndefined()
  expect(forkProgress(outline, 1)).toBeUndefined()
})
it('updates the gap and navigates each named turn; independent Sessions never show a gap', () => {
  const controller = new SidecarController(); const jump = vi.spyOn(controller, 'jumpToTurn')
  const el = document.createElement('div'); const root = createRoot(el)
  const render = (independent = false, entries = outline) => act(() => root.render(createElement(ForkContext, { controller, parent: 'parent', independent, progress: forkProgress(entries, 19), running: true })))
  render(false, outline.slice(0, 2)); expect(el.textContent).toContain('落后 1 轮')
  render(); expect(el.textContent).toContain('落后 2 轮'); expect(el.textContent).toContain('进行中')
  const buttons = [...el.querySelectorAll('button')]
  act(() => buttons.forEach(b => b.click()))
  expect(jump.mock.calls.map(c => c[1].turn)).toEqual([1, 2, 3])
  render(true); expect(el.textContent).toContain('独立会话'); expect(el.textContent).not.toContain('新增')
  act(() => root.unmount())
})

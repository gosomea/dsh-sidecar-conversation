// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { assistantSelectionRow, closestCandidate } from '../src/client/selection.js'

function row(text: string, top = 50): HTMLElement {
  const element = document.createElement('div')
  element.dataset.chatFlowKind = 'assistant'
  element.textContent = text
  Object.defineProperty(element, 'innerText', { value: text, configurable: true })
  element.getBoundingClientRect = () => ({ top, bottom: top + 40 } as DOMRect)
  document.body.append(element)
  return element
}

describe('selection candidate routing', () => {
  it('accepts only assistant text containing the normalized selection', () => {
    const marker = document.createElement('span')
    marker.getBoundingClientRect = () => ({ top: 100 } as DOMRect)
    expect(closestCandidate([
      { messageId: 'b', sourceSeq: 2, text: '**selected** source text', marker },
    ], 'selected source text', row('selected source text'))?.messageId).toBe('b')
  })

  it('uses the nearest action marker when identical text occurs in multiple messages', () => {
    const near = document.createElement('span')
    const far = document.createElement('span')
    near.getBoundingClientRect = () => ({ top: 120 } as DOMRect)
    far.getBoundingClientRect = () => ({ top: 360 } as DOMRect)
    expect(closestCandidate([
      { messageId: 'far', sourceSeq: 1, text: 'same quote', marker: far },
      { messageId: 'near', sourceSeq: 2, text: 'same quote', marker: near },
    ], 'same quote', row('same quote', 60))?.messageId).toBe('near')
  })

  it('accepts a selection only when both endpoints stay inside one Assistant row', () => {
    const assistant = row('select this answer')
    const text = assistant.firstChild
    const range = document.createRange()
    range.setStart(text!, 0); range.setEnd(text!, 6)
    const selection = window.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    expect(assistantSelectionRow(selection)).toBe(assistant)
  })
})

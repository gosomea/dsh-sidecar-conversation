import { describe, it, expect } from 'vitest'
import { sidecarQuestionDisplay } from '../src/client/question-display.js'
import { wrapFirstQuestion, wrapSidecarQuestion } from '../src/core/quote.js'
const facts = { read: () => undefined }
describe('Sidecar display projection', () => {
  it('keeps the exact durable source while displaying only the question', () => {
    for (const text of [wrapFirstQuestion('', '为什么？', 'turn'), wrapSidecarQuestion('为什么？')]) {
      expect(sidecarQuestionDisplay.match(text, 0, facts)).toEqual({ id: 'text', start: 0, end: text.length, data: { text, display: '为什么？' } })
    }
  })
  it('does not transform ordinary prose or rematch a consumed span', () => {
    expect(sidecarQuestionDisplay.match('这是普通用户消息', 0, facts)).toBeUndefined()
    expect(sidecarQuestionDisplay.match(wrapSidecarQuestion('问'), 1, facts)).toBeUndefined()
  })
})

import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { unwrapSidecarQuestion } from '../core/quote.js'

/** Display generated Sidecar envelopes as the human question; retain the durable source text. */
export const sidecarQuestionDisplay: UserTextRule = {
  id: 'sidecar-question-display', order: 0,
  match(text, from) {
    if (text.includes('<sidecar_reference>')) {
      const display = unwrapSidecarQuestion(text).question
      const start = text.indexOf(display)
      if (display !== text && start > 0 && from === 0) return { id: 'text', start: 0, end: start, data: { text: text.slice(0, start), display: '' } }
      const end = start + display.length
      if (display !== text && from <= end && end < text.length) return { id: 'text', start: end, end: text.length, data: { text: text.slice(end), display: '' } }
      return undefined
    }
    if (from !== 0 || !text.startsWith('这是')) return undefined
    const display = unwrapSidecarQuestion(text).question
    if (display === text) return undefined
    return { id: 'text', start: 0, end: text.length, data: { text, display } }
  },
}

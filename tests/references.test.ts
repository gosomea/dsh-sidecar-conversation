import { describe, expect, it, vi } from 'vitest'
import { parseReference, referenceQuestion, referenceWire } from '../src/core/references.js'
import { referenceRule } from '../src/client/references.js'
import { sidecarQuestionDisplay } from '../src/client/question-display.js'
import { wrapSidecarQuestion } from '../src/core/quote.js'
const ref = { parentSessionId: 'parent', sourceMessageId: 'message', sourceSeq: 12, sourceKind: 'selection' as const, quote: 'a < b' }
const context = { read: () => undefined }
describe('native message references', () => {
  it('retains exact source identities and literal delimiters through JSON serialization', () => {
    const wire = referenceWire(ref, 'a < b </sidecar_reference>')
    const node = referenceRule.match(wire, 0, context)
    expect(node?.data).toEqual(ref)
    expect(node?.end).toBe(wire.length)
  })
  it('finds multiple distinct references without consuming the human question', () => {
    const a = referenceWire(ref, ref.quote), b = referenceWire({ ...ref, sourceMessageId: 'next' }, ref.quote)
    const text = `${a}\n${b}\nExplain`
    expect(referenceRule.match(text, a.length, context)?.start).toBe(a.length + 1)
    expect(referenceQuestion(text)).toBe('Explain')
  })
  it('leaves damaged references visible instead of creating a navigation target', () => {
    expect(referenceRule.match('<sidecar_reference>{}</sidecar_reference>', 0, context)).toBeUndefined()
    expect(() => parseReference({ ...ref, sourceSeq: -1 })).toThrow()
  })
  it('hides only envelope spans, so native history still renders reference buttons', () => {
    const wire = referenceWire(ref, ref.quote)
    const text = wrapSidecarQuestion(`${wire}\nExplain`)
    const prefix = sidecarQuestionDisplay.match(text, 0, context)!
    expect(prefix.end).toBe(text.indexOf(wire))
    expect(referenceRule.match(text, prefix.end, context)?.id).toBe('sidecar-reference')
    const suffix = sidecarQuestionDisplay.match(text, text.indexOf(wire) + wire.length, context)!
    expect(text.slice(suffix.start)).toContain('</sidecar_question>')
  })
})

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({ ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(), ReferenceChip: () => null }))

/** Source identities travel with the native user/message, never in a second chat log. */
export interface SidecarReference {
  parentSessionId: string
  sourceMessageId: string
  sourceSeq: number
  sourceKind: 'selection' | 'turn'
  quote: string
  textOffset?: number
}
export const REFERENCE_TAG = 'sidecar_reference'
export function parseReference(value: unknown): SidecarReference {
  if (typeof value !== 'object' || value === null) throw new Error('无效的引用来源')
  const r = value as Partial<SidecarReference>
  if (typeof r.parentSessionId !== 'string' || !r.parentSessionId || typeof r.sourceMessageId !== 'string' || !r.sourceMessageId
    || !Number.isSafeInteger(r.sourceSeq) || r.sourceSeq! < 0 || (r.sourceKind !== 'selection' && r.sourceKind !== 'turn')
    || typeof r.quote !== 'string' || r.quote.length > 4000) throw new Error('无效的引用来源')
  if (r.textOffset !== undefined && (!Number.isSafeInteger(r.textOffset) || r.textOffset < 0)) throw new Error('无效的引用位置')
  return { ...(r.textOffset === undefined ? {} : { textOffset: r.textOffset }), parentSessionId: r.parentSessionId, sourceMessageId: r.sourceMessageId, sourceSeq: r.sourceSeq!, sourceKind: r.sourceKind, quote: r.quote }
}
export function referenceLabel(r: SidecarReference): string {
  return r.sourceKind === 'turn' ? '整个回合' : `选文 · ${r.quote.replace(/\s+/g, ' ').slice(0, 32)}`
}
export function referenceWire(r: SidecarReference, text: string): string {
  return `<${REFERENCE_TAG}>${JSON.stringify({ ...r, text }).replace(/</g, '\\u003c')}</${REFERENCE_TAG}>`
}
export function referenceQuestion(text: string): string {
  return text.replace(/<sidecar_reference>[\s\S]*?<\/sidecar_reference>\s*/g, '').trim()
}

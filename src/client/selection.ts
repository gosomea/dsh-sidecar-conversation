import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { normalizeQuote, textContainsQuote } from '../core/quote.js'

interface AssistantData {
  finalNode?: { messageId?: string; seq: number; blocks: readonly { kind: string; text?: string }[] }
}

export interface AssistantCandidate {
  messageId: string
  sourceSeq: number
  text: string
  marker?: HTMLElement
}

function sourceFromFinal(final: NonNullable<AssistantData['finalNode']>): { messageId: string; sourceSeq: number; text: string } | undefined {
  if (final.messageId === undefined) return undefined
  return {
    messageId: final.messageId,
    sourceSeq: final.seq,
    text: final.blocks.filter(block => block.kind === 'text').map(block => block.text ?? '').join('\n'),
  }
}

export function findAssistantSource(snapshot: ConversationSnapshot, messageId: string): { sourceSeq: number; text: string } | undefined {
  for (const node of snapshot.chat.nodes.values()) {
    const data = (node as unknown as { kind?: string; data?: AssistantData }).data
    const final = data?.finalNode
    if (final?.messageId !== messageId) continue
    return { sourceSeq: final.seq, text: final.blocks.filter(block => block.kind === 'text').map(block => block.text ?? '').join('\n') }
  }
  return undefined
}

/** Resolve the exact finalized Assistant node owning one rendered chat row. */
export function assistantSourceForRow(snapshot: ConversationSnapshot, sourceRow: HTMLElement): AssistantCandidate | undefined {
  const nodeKey = sourceRow.dataset.chatFlowKey
  if (nodeKey === undefined) return undefined
  const node = snapshot.chat.nodes.get(nodeKey)
  const final = (node as unknown as { data?: AssistantData } | undefined)?.data?.finalNode
  return final === undefined ? undefined : sourceFromFinal(final)
}

export function findAssistantAtSeq(snapshot: ConversationSnapshot, sourceSeq: number): { messageId: string; sourceSeq: number; text: string } | undefined {
  for (const node of snapshot.chat.nodes.values()) {
    const final = (node as unknown as { data?: AssistantData }).data?.finalNode
    if (final?.seq !== sourceSeq || final.messageId === undefined) continue
    return {
      messageId: final.messageId,
      sourceSeq,
      text: final.blocks.filter(block => block.kind === 'text').map(block => block.text ?? '').join('\n'),
    }
  }
  return undefined
}

export function assistantSelectionRow(selection: Selection): HTMLElement | undefined {
  if (selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement
  const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement
  const row = start?.closest<HTMLElement>('[data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"]')
  if (row === null || row === undefined || !row.contains(end)) return undefined
  // Sidecars are bound to the currently selected main Session. Do not offer
  // a nested Sidecar action for text rendered by an embedded child Surface.
  if (row.closest('[data-sidecar-native-surface]') !== null) return undefined
  return row
}

export function closestCandidate(candidates: readonly AssistantCandidate[], quote: string, sourceRow: HTMLElement): AssistantCandidate | undefined {
  const normalized = normalizeQuote(quote).replace(/\s+/g, ' ')
  if (!sourceRow.innerText.replace(/\s+/g, ' ').includes(normalized)) return undefined
  const rowRect = sourceRow.getBoundingClientRect()
  return candidates
    .filter(candidate => candidate.marker !== undefined && textContainsQuote(candidate.text, quote))
    .sort((a, b) => {
      const aTop = a.marker?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY
      const bTop = b.marker?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY
      const aDistance = aTop >= rowRect.top ? aTop - rowRect.bottom : Number.POSITIVE_INFINITY
      const bDistance = bTop >= rowRect.top ? bTop - rowRect.bottom : Number.POSITIVE_INFINITY
      return aDistance - bDistance
    })[0]
}

export function selectedQuoteForMessage(snapshot: ConversationSnapshot, messageId: string, selectedText: string): { sourceSeq: number; quote: string } {
  const source = findAssistantSource(snapshot, messageId)
  if (source === undefined) throw new Error('找不到这条已完成的 Assistant 消息')
  const quote = normalizeQuote(selectedText)
  if (!textContainsQuote(source.text, quote)) {
    throw new Error('选中的文字必须来自这条 Assistant 消息')
  }
  return { sourceSeq: source.sourceSeq, quote }
}

import type { HistoryEvent, TranscriptItem } from './types.js'
import { unwrapSidecarQuestion } from './quote.js'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : undefined
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n')
  const item = record(value)
  if (item === undefined) return ''
  if (typeof item.text === 'string') return item.text
  if (typeof item.output === 'string') return item.output
  if (typeof item.content !== 'undefined') return contentText(item.content)
  if (typeof item.message !== 'undefined') return contentText(item.message)
  return ''
}

export function mergeEvents(current: readonly HistoryEvent[], incoming: readonly HistoryEvent[]): HistoryEvent[] {
  const bySeq = new Map<number, HistoryEvent>()
  for (const event of current) bySeq.set(event.seq, event)
  for (const event of incoming) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

export function eventRpcId(event: HistoryEvent): string | undefined {
  const data = record(event.data)
  const message = record(data?.message)
  const source = record(message?.source ?? data?.source)
  return typeof source?.rpcId === 'string' ? source.rpcId : undefined
}

export function hasPromptRpcId(events: readonly HistoryEvent[], rpcId: string): boolean {
  return events.some(event => event.type === 'user/message' && eventRpcId(event) === rpcId)
}

export function assistantMessage(event: HistoryEvent): { messageId: string; text: string } | undefined {
  if (event.type !== 'assistant/message') return undefined
  const data = record(event.data)
  const message = record(data?.message)
  const id = message?.id ?? data?.id
  if (typeof id !== 'string') return undefined
  return { messageId: id, text: contentText(message?.content ?? data?.content) }
}

export function transcriptFromEvents(events: readonly HistoryEvent[], fromRpcId?: string): TranscriptItem[] {
  const result: TranscriptItem[] = []
  let visible = fromRpcId === undefined
  for (const event of events) {
    const rpcId = eventRpcId(event)
    if (!visible && rpcId === fromRpcId) visible = true
    if (!visible) continue
    const data = record(event.data)
    const text = contentText(data?.message ?? data?.content ?? data)
    if (event.type === 'user/message') {
      const unwrapped = unwrapSidecarQuestion(text)
      result.push({
        key: `${event.seq}:user`, seq: event.seq, kind: 'user', text: unwrapped.question,
        ...(rpcId === undefined ? {} : { rpcId }),
        ...(unwrapped.sourceKind === undefined ? {} : { sourceKind: unwrapped.sourceKind }),
        ...(unwrapped.quote === undefined ? {} : { quote: unwrapped.quote }),
      })
    } else if (event.type === 'assistant/message') {
      const message = record(data?.message)
      const blocks = Array.isArray(message?.content) ? message.content : []
      for (const [index, blockValue] of blocks.entries()) {
        const block = record(blockValue)
        if (block?.type === 'reasoning') {
          result.push({ key: `${event.seq}:reasoning:${index}`, seq: event.seq, kind: 'reasoning', text: contentText(block), collapsed: true })
        } else if (block?.type === 'tool-call') {
          result.push({ key: `${event.seq}:tool:${index}`, seq: event.seq, kind: 'tool', text: `${String(block.name ?? 'tool')}\n${String(block.arguments ?? '')}`, collapsed: true })
        } else if (block?.type === 'text') {
          result.push({ key: `${event.seq}:assistant:${index}`, seq: event.seq, kind: 'assistant', text: contentText(block) })
        }
      }
      if (blocks.length === 0 && text) result.push({ key: `${event.seq}:assistant`, seq: event.seq, kind: 'assistant', text })
    } else if (event.type === 'tool/result') {
      result.push({ key: `${event.seq}:tool`, seq: event.seq, kind: 'tool', text: text || JSON.stringify(event.data), collapsed: true })
    } else if (event.type.includes('error')) {
      result.push({ key: `${event.seq}:error`, seq: event.seq, kind: 'error', text: text || event.type })
    }
  }
  return result
}

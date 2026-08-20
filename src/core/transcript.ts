import type { HistoryEvent } from './types.js'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : undefined
}

function contentText(value: unknown): string {
  const texts: string[] = []
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string') {
      if (current !== '') texts.push(current)
      continue
    }
    if (typeof current !== 'object' || current === null || seen.has(current)) continue
    seen.add(current)
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) pending.push(current[index])
      continue
    }
    const item = current as UnknownRecord
    if (typeof item.text === 'string') { if (item.text !== '') texts.push(item.text); continue }
    if (typeof item.output === 'string') { if (item.output !== '') texts.push(item.output); continue }
    if (typeof item.content !== 'undefined') { pending.push(item.content); continue }
    if (typeof item.message !== 'undefined') pending.push(item.message)
  }
  return texts.join('\n')
}

export function mergeEvents(current: readonly HistoryEvent[], incoming: readonly HistoryEvent[]): HistoryEvent[] {
  const bySeq = new Map<number, HistoryEvent>()
  for (const event of current) bySeq.set(event.seq, event)
  for (const event of incoming) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/** Find a history page boundary without spreading an unbounded event array into function arguments. */
export function minimumEventSeq(events: readonly HistoryEvent[]): number {
  if (events.length === 0) throw new Error('cannot find the boundary of an empty history page')
  let minimum = events[0]?.seq ?? Number.POSITIVE_INFINITY
  for (let index = 1; index < events.length; index += 1) {
    const seq = events[index]?.seq
    if (seq !== undefined && seq < minimum) minimum = seq
  }
  return minimum
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

/** Recover the exact durable text associated with one user prompt event. */
export function userMessageText(event: HistoryEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  const data = record(event.data)
  return contentText(data?.message ?? data?.content ?? data)
}

export function assistantMessage(event: HistoryEvent): { messageId: string; text: string } | undefined {
  if (event.type !== 'assistant/message') return undefined
  const data = record(event.data)
  const message = record(data?.message)
  const id = message?.id ?? data?.id
  if (typeof id !== 'string') return undefined
  return { messageId: id, text: contentText(message?.content ?? data?.content) }
}

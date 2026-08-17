import { useEffect, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { HistoryEvent } from '../core/types.js'
import { mergeEvents } from '../core/transcript.js'
import { SidecarApi } from './api.js'

function unwrapHistory(response: Awaited<ReturnType<ConnectionHandle['api']['sessions']['history']>>): HistoryEvent[] {
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value.events.map(entry => entry.event as HistoryEvent)
}

export function useSidecarEvents(api: SidecarApi, connection: ConnectionHandle, childSessionId: string): {
  events: HistoryEvent[]; error?: string
} {
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    let source: EventSource | undefined
    const load = async (): Promise<void> => {
      const response = await connection.api.sessions.history({ sessionId: childSessionId as SessionId, maxMessages: 200 })
      if (live) setEvents(current => mergeEvents(current, unwrapHistory(response)))
    }
    source = api.events(childSessionId)
    source.addEventListener('ready', () => { void load().catch(reason => { if (live) setError(String(reason)) }) })
    source.addEventListener('event', event => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as HistoryEvent
        if (live) setEvents(current => mergeEvents(current, [parsed]))
      } catch (reason: unknown) { if (live) setError(String(reason)) }
    })
    source.onerror = () => { if (live) setError('实时连接中断，正在重连…') }
    return () => { live = false; source?.close() }
  }, [api, childSessionId, connection])
  return { events, ...(error === undefined ? {} : { error }) }
}

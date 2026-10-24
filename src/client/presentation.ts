import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidecarRecord } from '../core/types.js'

export function plainTitle(title: string): string {
  return title.replace(/^(?:↳\s*侧问\s*·\s*)+/, '')
}

export function nativeTitle(record: SidecarRecord, sessions?: SessionListState): string {
  const summary = sessions?.byId[record.childSessionId as SessionId]
  return plainTitle(summary ? (summary.blank ? '新会话' : summary.title || '未命名') : record.title)
}

/** Filter a native order; missing/deleted sessions retain their index order at the end. */
export function nativeHistory(records: readonly SidecarRecord[], order: readonly string[]): SidecarRecord[] {
  const remaining = new Map(records.map(record => [record.childSessionId, record]))
  const result: SidecarRecord[] = []
  for (const id of order) {
    const record = remaining.get(id)
    if (record) { result.push(record); remaining.delete(id) }
  }
  return [...result, ...remaining.values()]
}

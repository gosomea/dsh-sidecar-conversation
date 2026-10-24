import { expect, it } from 'vitest'
import { nativeHistory, nativeTitle, plainTitle } from '../src/client/presentation.js'
import type { SidecarRecord } from '../src/core/types.js'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

it('uses native titles for legacy and new sidecars without persisting a tree prefix', () => {
  for (const nativeComposer of [false, true]) {
    const record = { childSessionId: 'child', title: '↳ 侧问 · stale', nativeComposer } as SidecarRecord
    const list = { byId: { child: { title: 'work1' } } } as unknown as SessionListState
    expect(nativeTitle(record, list)).toBe('work1')
    expect(record.title).toBe('↳ 侧问 · stale')
  }
  expect(plainTitle('↳ 侧问 · ↳ 侧问 · Topic')).toBe('Topic')
  expect(plainTitle('a ↳ arrow')).toBe('a ↳ arrow')
})

it('filters native manual/pinned order, including archives, without using registry times', () => {
  const records = [{ childSessionId: 'a', updatedAt: 99 }, { childSessionId: 'b', updatedAt: 1, status: 'archived' }, { childSessionId: 'deleted' }] as SidecarRecord[]
  expect(nativeHistory(records, ['parent', 'b', 'other', 'a']).map(r => r.childSessionId)).toEqual(['b', 'a', 'deleted'])
  expect(nativeHistory(records, ['a', 'b']).map(r => r.childSessionId)).toEqual(['a', 'b', 'deleted'])
})

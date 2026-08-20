// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SidecarClientStore } from '../src/client/store.js'
import { SIDECAR_UI_STORAGE_KEY, type SidecarRecord } from '../src/core/types.js'

function record(parentSessionId: string, childSessionId: string, status: SidecarRecord['status'] = 'active'): SidecarRecord {
  return {
    parentSessionId,
    childSessionId,
    requestKey: `request-${childSessionId}`,
    sourceMessageId: 'message',
    sourceSeq: 1,
    sourceKind: 'turn',
    quote: '',
    firstQuestion: 'question',
    firstPromptRpcId: `rpc-${childSessionId}`,
    access: { mode: 'read-only' },
    title: childSessionId,
    createdAt: 1,
    updatedAt: 1,
    status,
  }
}

describe('SidecarClientStore', () => {
  beforeEach(() => { localStorage.clear() })

  it('isolates registry records and loading state by parent Session', () => {
    const store = new SidecarClientStore()
    store.setLoading('parent-a')
    store.setLoading('parent-b')
    store.setRecords('parent-a', [record('parent-a', 'child-a')])

    expect(store.records('parent-a').map(item => item.childSessionId)).toEqual(['child-a'])
    expect(store.records('parent-b')).toEqual([])
    expect(store.getSnapshot().loadingParents).toEqual({ 'parent-a': false, 'parent-b': true })
  })

  it('clears loading atomically and keeps a retryable load error', () => {
    const store = new SidecarClientStore()
    store.setLoading('parent')
    store.setLoadError('parent', new Error('暂时无法连接'))

    expect(store.getSnapshot().loadingParents.parent).toBe(false)
    expect(store.getSnapshot().error).toBe('暂时无法连接')
  })

  it('infers the source kind for legacy records without sourceKind', () => {
    const store = new SidecarClientStore()
    store.setRecords('parent', [
      { ...record('parent', 'turn-child'), sourceKind: undefined, quote: '' },
      { ...record('parent', 'selection-child'), sourceKind: undefined, quote: 'selected text' },
    ])

    expect(store.records('parent').map(item => item.sourceKind)).toEqual(['turn', 'selection'])
  })

  it('does not rewrite the legacy drawer document', () => {
    localStorage.setItem(SIDECAR_UI_STORAGE_KEY, JSON.stringify({ byParent: { parent: { open: true, width: 620 } } }))
    const before = localStorage.getItem(SIDECAR_UI_STORAGE_KEY)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const store = new SidecarClientStore()
    store.setRecords('parent', [record('parent', 'child')])

    expect(localStorage.getItem(SIDECAR_UI_STORAGE_KEY)).toBe(before)
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('shows a prompt optimistically and removes it when its RPC event arrives', () => {
    const store = new SidecarClientStore()
    store.addOptimistic({ childSessionId: 'child', requestKey: 'request-1', question: 'visible now' })
    expect(store.getSnapshot().optimisticByChild.child?.[0]).toMatchObject({ question: 'visible now', state: 'sending' })
    store.ackOptimistic('child', 'request-1', 'rpc-1')
    store.resolveOptimistic('child', new Set(['rpc-1']))
    expect(store.getSnapshot().optimisticByChild.child).toEqual([])
  })

  it('keeps a failed optimistic prompt visible with its error', () => {
    const store = new SidecarClientStore()
    store.addOptimistic({ childSessionId: 'child', requestKey: 'request-1', question: 'retry me' })
    store.failOptimistic('child', 'request-1', new Error('network down'))
    expect(store.getSnapshot().optimisticByChild.child?.[0]).toMatchObject({ state: 'failed', error: 'network down' })
  })

  it('notifies subscribers and clears a stale error after a successful list refresh', () => {
    const store = new SidecarClientStore()
    const listener = vi.fn()
    const dispose = store.subscribe(listener)
    store.setError(new Error('offline'))
    store.setRecords('parent', [record('parent', 'child')])

    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().error).toBeUndefined()
    dispose()
  })
})

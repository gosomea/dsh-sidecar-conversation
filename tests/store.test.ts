// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { SidecarClientStore } from '../src/client/store.js'

describe('parent-scoped UI state', () => {
  beforeEach(() => { localStorage.clear() })

  it('isolates drafts, active tabs, open state and width by parent', () => {
    const store = new SidecarClientStore()
    store.openDraft('parent-a', { sourceKind: 'selection', sourceMessageId: 'm1', sourceSeq: 1, quote: 'a', question: '', accessMode: 'read-only' })
    store.openDraft('parent-b', { sourceKind: 'turn', sourceMessageId: 'm2', sourceSeq: 2, quote: '', question: '', accessMode: 'inherit' })
    store.updateDraftQuestion('parent-a', 'only a')
    store.resize('parent-a', 600)
    store.close('parent-b')
    expect(store.parent('parent-a').draft?.question).toBe('only a')
    expect(store.parent('parent-b').draft?.question).toBe('')
    expect(store.parent('parent-a').width).toBe(600)
    expect(store.parent('parent-b').open).toBe(false)
  })

  it('restores state from the versioned browser key', () => {
    const first = new SidecarClientStore()
    first.openDraft('parent-a', { sourceKind: 'selection', sourceMessageId: 'm1', sourceSeq: 1, quote: 'a', question: 'draft', accessMode: 'read-only' })
    const restored = new SidecarClientStore()
    expect(restored.parent('parent-a').draft?.question).toBe('draft')
  })

  it('removes only the selected quote while preserving the question draft', () => {
    const store = new SidecarClientStore()
    store.openDraft('parent-a', {
      sourceKind: 'selection', sourceMessageId: 'm1', sourceSeq: 1, quote: 'selected', question: 'why?', accessMode: 'read-only',
    })

    store.useWholeTurnDraft('parent-a')

    expect(store.parent('parent-a').draft).toEqual({
      sourceKind: 'turn', sourceMessageId: 'm1', sourceSeq: 1, quote: '', question: 'why?', accessMode: 'read-only', forceNew: true,
    })
    expect(store.parent('parent-a').open).toBe(true)
  })

  it('persists the explicit new-Sidecar choice with the parent draft', () => {
    const store = new SidecarClientStore()
    store.openDraft('parent-a', { sourceKind: 'turn', sourceMessageId: 'm1', sourceSeq: 1, quote: '', question: 'why?', accessMode: 'read-only' })
    store.setDraftForceNew('parent-a', true)
    expect(store.parent('parent-a').draft?.forceNew).toBe(true)
    expect(new SidecarClientStore().parent('parent-a').draft?.forceNew).toBe(true)
  })

  it('starts parent-originated drafts as a new Sidecar and permits explicit reuse', () => {
    const store = new SidecarClientStore()
    store.openDraft('parent-a', {
      sourceKind: 'turn', sourceMessageId: 'm1', sourceSeq: 1, quote: '', question: '', accessMode: 'read-only',
    })
    expect(store.parent('parent-a').draft?.forceNew).toBe(true)
    store.setDraftForceNew('parent-a', false)
    expect(store.parent('parent-a').draft?.forceNew).toBe(false)
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

  it('opens a selected historical Sidecar instead of leaving the draft over it', () => {
    const store = new SidecarClientStore()
    store.openDraft('parent-a', {
      sourceKind: 'selection', sourceMessageId: 'm1', sourceSeq: 1, quote: 'selected', question: 'draft', accessMode: 'read-only',
    })
    store.select('parent-a', 'child-history')
    expect(store.parent('parent-a')).toMatchObject({
      activeChildSessionId: 'child-history', open: true,
    })
    expect(store.parent('parent-a').draft).toBeUndefined()
  })
})

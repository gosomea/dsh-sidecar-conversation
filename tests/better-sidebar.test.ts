import { describe, expect, it, vi } from 'vitest'
import type { SidecarDraft } from '../src/core/types.js'
import {
  betterSidebarTabState,
  closeSidecar,
  openSidecarActive,
  openSidecarDraft,
  openSidecarHistory,
  registerSidecarTabs,
  sidecarMetaFromTab,
  updateSidecarActive,
  type BetterSidebarService,
} from '../src/client/better-sidebar.js'
import {
  activeSidecarTabMeta,
  draftSidecarTabMeta,
  parseSidecarTabMeta,
  sidecarTabId,
  sidecarTabPath,
  SIDECAR_CHAT_TAB_TYPE,
  SIDECAR_HISTORY_TAB_TYPE,
} from '../src/client/tab-meta.js'

function draft(): SidecarDraft {
  return {
    sourceKind: 'selection',
    sourceMessageId: 'message-1',
    sourceSeq: 42,
    quote: 'quoted text',
    question: 'why?',
    accessMode: 'read-only',
  }
}

function serviceStub(): BetterSidebarService & {
  registrations: Array<{ id: string; component: unknown }>
  opens: Array<{ seed: unknown; scope: unknown }>
  activations: Array<{ id: string; scope: unknown }>
  updates: Array<{ id: string; patch: unknown }>
  closes: Array<{ id: string; scope: unknown }>
  disposed: string[]
} {
  const result = {
    registrations: [] as Array<{ id: string; component: unknown }>,
    opens: [] as Array<{ seed: unknown; scope: unknown }>,
    activations: [] as Array<{ id: string; scope: unknown }>,
    updates: [] as Array<{ id: string; patch: unknown }>,
    closes: [] as Array<{ id: string; scope: unknown }>,
    disposed: [] as string[],
    registerTab: vi.fn((descriptor: { id: string; component: unknown }) => {
      result.registrations.push({ id: descriptor.id, component: descriptor.component })
      return () => { result.disposed.push(descriptor.id) }
    }),
    openTab: vi.fn((seed: unknown, scope: unknown) => { result.opens.push({ seed, scope }) }),
    activateTab: vi.fn((id: string, scope: unknown) => { result.activations.push({ id, scope }) }),
    updateTab: vi.fn((id: string, patch: unknown) => { result.updates.push({ id, patch }) }),
    closeTab: vi.fn((id: string, scope: unknown) => { result.closes.push({ id, scope }) }),
    getSnapshot: vi.fn(() => ({ sessionId: undefined, state: undefined })),
    subscribeState: vi.fn(() => () => undefined),
  }
  return result as unknown as BetterSidebarService & {
    registrations: Array<{ id: string; component: unknown }>
    opens: Array<{ seed: unknown; scope: unknown }>
    activations: Array<{ id: string; scope: unknown }>
    updates: Array<{ id: string; patch: unknown }>
    closes: Array<{ id: string; scope: unknown }>
    disposed: string[]
  }
}

describe('Sidecar Better Sidebar adapter', () => {
  it('registers chat/history descriptors and disposes both through ctx.effect', () => {
    const service = serviceStub()
    let effectDisposer: (() => unknown) | undefined
    const ctx = {
      get: () => service,
      effect: vi.fn((execute: () => (() => void), _label?: string) => {
        effectDisposer = execute()
        return () => effectDisposer?.()
      }),
    }
    const chat = vi.fn(() => null)
    const history = vi.fn(() => null)

    const dispose = registerSidecarTabs(ctx, { chat, history })

    expect(ctx.effect).toHaveBeenCalledOnce()
    expect(service.registrations.map(item => item.id)).toEqual([
      SIDECAR_CHAT_TAB_TYPE,
      SIDECAR_HISTORY_TAB_TYPE,
    ])
    dispose()
    expect(service.disposed).toEqual([SIDECAR_HISTORY_TAB_TYPE, SIDECAR_CHAT_TAB_TYPE])
    dispose()
    expect(service.disposed).toHaveLength(2)
  })

  it('does not create a pending effect when Better Sidebar is absent', () => {
    const effect = vi.fn()
    const dispose = registerSidecarTabs({ get: () => undefined, effect }, {
      chat: () => null,
      history: () => null,
    })

    expect(effect).not.toHaveBeenCalled()
    expect(() => dispose()).not.toThrow()
  })

  it('uses a dynamic child injection seam and awaits its child disposer once', async () => {
    const service = serviceStub()
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    const childDispose = vi.fn(() => released)
    const inject = vi.fn((_deps: string[], callback: (ctx: { get: () => unknown }) => void) => {
      callback({ get: () => service })
      return { dispose: childDispose }
    })
    const dispose = registerSidecarTabs({ get: () => undefined, inject }, {
      chat: () => null,
      history: () => null,
    })

    expect(inject).toHaveBeenCalledWith(['betterSidebar'], expect.any(Function))
    expect(service.registrations).toHaveLength(2)
    const disposing = dispose()
    const duplicate = dispose()
    expect(childDispose).toHaveBeenCalledOnce()
    expect(duplicate).toBeUndefined()
    release()
    await expect(disposing).resolves.toBeUndefined()
  })

  it('opens a draft with stable id/path and an explicit parent scope', () => {
    const service = serviceStub()
    openSidecarDraft(service, {
      parentSessionId: 'parent-1',
      requestKey: 'parent-1:selection:request-1',
      draft: draft(),
    })

    const open = service.opens[0]
    expect(open?.scope).toEqual({ sessionId: 'parent-1' })
    expect(open?.seed).toMatchObject({
      type: SIDECAR_CHAT_TAB_TYPE,
      id: sidecarTabId('parent-1:selection:request-1'),
      path: sidecarTabPath('parent-1:selection:request-1'),
      meta: draftSidecarTabMeta('parent-1', 'parent-1:selection:request-1', draft()),
    })
    expect(service.activations).toEqual([{
      id: sidecarTabId('parent-1:selection:request-1'),
      scope: { sessionId: 'parent-1' },
    }])
  })

  it('opens and updates an active Sidecar without changing its id/path', () => {
    const service = serviceStub()
    const record = { parentSessionId: 'parent-1', requestKey: 'request-1', childSessionId: 'child-1' }
    openSidecarActive(service, { record, title: '侧问 · request-1' })
    updateSidecarActive(service, record, '侧问 · updated')

    expect(service.opens[0]?.scope).toEqual({ sessionId: 'parent-1' })
    expect(service.opens[0]?.seed).toMatchObject({
      id: sidecarTabId('request-1'),
      path: sidecarTabPath('request-1'),
      meta: activeSidecarTabMeta(record),
    })
    expect(service.updates).toEqual([{
      id: sidecarTabId('request-1'),
      patch: { path: sidecarTabPath('request-1'), meta: activeSidecarTabMeta(record), title: '侧问 · updated' },
    }])
    expect(service.activations).toEqual([{
      id: sidecarTabId('request-1'),
      scope: { sessionId: 'parent-1' },
    }])
  })

  it('targets history and close operations at the same parent session', () => {
    const service = serviceStub()
    openSidecarHistory(service, 'parent-2', '/workspace')
    closeSidecar(service, 'parent-2', 'request-2', '/workspace')

    expect(service.opens[0]?.scope).toEqual({ sessionId: 'parent-2', cwd: '/workspace' })
    expect(service.opens[0]?.seed).toMatchObject({ type: SIDECAR_HISTORY_TAB_TYPE, path: expect.stringContaining('sidecar://') })
    expect(service.closes).toEqual([{
      id: sidecarTabId('request-2'),
      scope: { sessionId: 'parent-2', cwd: '/workspace' },
    }])
    expect(service.activations).toEqual([{
      id: SIDECAR_HISTORY_TAB_TYPE,
      scope: { sessionId: 'parent-2', cwd: '/workspace' },
    }])
  })

  it('strictly rejects malformed or mismatched persisted meta', () => {
    const meta = draftSidecarTabMeta('parent-1', 'request-1', draft())
    expect(parseSidecarTabMeta(meta)).toEqual(meta)
    expect(sidecarMetaFromTab({ meta })).toEqual(meta)
    expect(parseSidecarTabMeta({ ...meta, version: 2 })).toBeUndefined()
    expect(parseSidecarTabMeta({ ...meta, requestKey: 'other' })).toBeUndefined()
    expect(parseSidecarTabMeta({ ...meta, draft: { ...meta.draft, requestKey: 'other' } })).toBeUndefined()
    expect(parseSidecarTabMeta({ ...meta, draft: { ...meta.draft, sourceSeq: -1 } })).toBeUndefined()
    expect(parseSidecarTabMeta({ version: 1, kind: 'active', parentSessionId: 'p', requestKey: 'r' })).toBeUndefined()
  })

  it('finds open tabs and the active tab across both sidebar trees', () => {
    const state = betterSidebarTabState({
      sessionId: 'parent-1',
      state: {
        activePane: 'bottom-pane',
        splits: {
          kind: 'leaf',
          id: 'right-pane',
          active: 'editor-1',
          tabs: [{ id: 'editor-1', type: 'editor', title: 'File' }],
        },
        bottomSplits: {
          kind: 'split',
          id: 'bottom-root',
          children: [{
            kind: 'leaf',
            id: 'bottom-pane',
            active: 'sidecar-1',
            tabs: [{ id: 'sidecar-1', type: SIDECAR_CHAT_TAB_TYPE, title: '侧问' }],
          }],
        },
      },
    })

    expect([...state.openTabIds]).toEqual(['editor-1', 'sidecar-1'])
    expect(state).toMatchObject({ sessionId: 'parent-1', activeTabId: 'sidecar-1' })
  })
})

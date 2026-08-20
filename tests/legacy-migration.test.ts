import { describe, expect, it } from 'vitest'
import { SIDECAR_UI_STORAGE_KEY, type SidecarRecord } from '../src/core/types.js'
import {
  migrateLegacySidecarTabs,
  migrateLegacySidecarUiState,
  readLegacySidecarUiState,
  type LegacyStorage,
} from '../src/client/legacy-migration.js'

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceKind: 'selection',
    sourceMessageId: 'assistant-1',
    sourceSeq: 42,
    quote: 'selected text',
    question: 'why?',
    accessMode: 'read-only',
    forceNew: true,
    requestKey: 'request-1',
    ...overrides,
  }
}

function legacyState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    byParent: {
      'parent-a': {
        open: true,
        width: 520,
        ...overrides,
      },
    },
  }
}

function record(overrides: Partial<SidecarRecord> = {}): SidecarRecord {
  return {
    parentSessionId: 'parent-a',
    childSessionId: 'child-a',
    requestKey: 'request-1',
    sourceMessageId: 'assistant-1',
    sourceSeq: 42,
    sourceKind: 'selection',
    quote: 'selected text',
    firstQuestion: 'why?',
    firstPromptRpcId: 'rpc-1',
    access: { mode: 'read-only' },
    title: '侧问 · request-1',
    createdAt: 1,
    updatedAt: 1,
    status: 'active',
    ...overrides,
  }
}

describe('legacy Better Sidebar tab migration', () => {
  it('converts a draft to a stable, JSON-safe chat seed', () => {
    const seeds = migrateLegacySidecarUiState(legacyState({ draft: draft() }))

    expect(seeds).toHaveLength(1)
    expect(seeds[0]).toMatchObject({
      id: 'sidecar:request-1',
      type: 'dsh-sidecar-conversation:chat',
      title: '侧问',
      path: 'sidecar://request-1',
      meta: {
        version: 1,
        kind: 'draft',
        parentSessionId: 'parent-a',
        requestKey: 'request-1',
        draft: { requestKey: 'request-1', question: 'why?' },
      },
    })
  })

  it('promotes the selected live record and ignores archived or mismatched records', () => {
    const raw = legacyState({ activeChildSessionId: 'child-a', draft: draft() })
    const seeds = migrateLegacySidecarUiState(raw, [
      record(),
      record({ childSessionId: 'archived-child', requestKey: 'archived', status: 'archived' }),
      record({ childSessionId: 'other-child', requestKey: 'other' }),
    ])

    expect(seeds).toHaveLength(1)
    expect(seeds[0]).toMatchObject({
      id: 'sidecar:request-1',
      title: '侧问 · request-1',
      path: 'sidecar://request-1',
      meta: {
        kind: 'active',
        parentSessionId: 'parent-a',
        requestKey: 'request-1',
        childSessionId: 'child-a',
      },
    })
  })

  it('keeps the active seed when a stale draft has the same request key', () => {
    const raw = {
      byParent: {
        'parent-a': { activeChildSessionId: 'child-a', draft: draft() },
        'parent-b': { draft: draft({ requestKey: 'request-1', sourceMessageId: 'assistant-2' }) },
      },
    }
    const seeds = migrateLegacySidecarUiState(raw, [record()])

    expect(seeds).toHaveLength(1)
    expect(seeds[0]?.meta.kind).toBe('active')
    expect(seeds[0]?.meta.parentSessionId).toBe('parent-a')
  })

  it('derives a stable key for old drafts that predate requestKey', () => {
    const raw = legacyState({ draft: draft({ requestKey: undefined }) })
    const first = migrateLegacySidecarUiState(raw)
    const second = migrateLegacySidecarUiState(JSON.parse(JSON.stringify(raw)) as unknown)

    expect(first).toEqual(second)
    expect(first[0]?.id).toMatch(/^sidecar:legacy-[0-9a-f]{8}$/)
    expect(first[0]?.meta).toMatchObject({ requestKey: expect.stringMatching(/^legacy-[0-9a-f]{8}$/) })
  })

  it('accepts legacy omitted defaults but rejects malformed and future shapes', () => {
    const raw = {
      byParent: {
        'parent-a': { draft: { ...draft(), sourceKind: undefined, accessMode: undefined } },
        'parent-b': { draft: draft({ sourceSeq: -1 }) },
        'parent-c': { draft: draft({ question: 7 }) },
        'parent-d': { draft: draft({ sourceKind: 'future-kind' }) },
        'parent-e': { activeChildSessionId: 42, draft: draft() },
        'parent-f': { width: 'wide', draft: draft() },
      },
    }

    const seeds = migrateLegacySidecarUiState(raw)
    expect(seeds).toHaveLength(1)
    expect(seeds[0]?.meta).toMatchObject({ kind: 'draft', parentSessionId: 'parent-a' })
  })

  it('ignores invalid JSON and storage errors without writing anything', () => {
    const writes: string[] = []
    const storage: LegacyStorage = {
      getItem: key => {
        expect(key).toBe(SIDECAR_UI_STORAGE_KEY)
        return '{not-json'
      },
    }
    const seeds = migrateLegacySidecarTabs({ storage })
    expect(seeds).toEqual([])
    expect(writes).toEqual([])

    expect(readLegacySidecarUiState({
      getItem: () => { throw new Error('private mode') },
    })).toBeUndefined()
  })

  it('is repeatable and deduplicates duplicate records', () => {
    const raw = legacyState({ activeChildSessionId: 'child-a' })
    const records = new Map([['parent-a', [record(), record()] as const]])
    const first = migrateLegacySidecarTabs({
      storage: { getItem: () => JSON.stringify(raw) },
      records,
    })
    const second = migrateLegacySidecarTabs({
      storage: { getItem: () => JSON.stringify(raw) },
      records,
    })

    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
  })
})

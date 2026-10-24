import { describe, expect, it } from 'vitest'
import { workspaceOrder } from '../src/client/workspace-adapter.js'

const row = (id: string, updatedAt: number, extra = {}) => ({ id, updatedAt, retainedBy: {}, blank: false, ...extra })
const view = (extra = {}): any => ({ groupBy: 'workspace', orderBy: 'manual', sessionOrderByAccount: {}, groupExpansion: {}, ...extra })
const registry = (extra = {}): any => ({ items: [], pinnedSessionIds: [], archivedSessionIds: [], ...extra })
const list = (rows: any[]): any => ({ ids: rows.map(s => s.id), byId: Object.fromEntries(rows.map(s => [s.id, s])) })
describe('plugin projection of the native Workspace view', () => {
  it('preserves manual positions, drops stale IDs, deduplicates, and inserts a new fork before its source', () => {
    const sessions = list([row('a', 1), row('b', 2), row('child', 3, { parentId: 'a' }), row('archive', 9)])
    expect(workspaceOrder(sessions, registry({ archivedSessionIds: ['archive'] }), view({ sessionOrderByAccount: { '': ['b', 'deleted', 'b', 'a'] } }))).toEqual(['b', 'child', 'a', 'archive'])
  })
  it('follows recency and deterministic ties, with pins ahead of ordinary rows', () => {
    const sessions = list([row('b', 2), row('a', 2), row('pin', 1)])
    expect(workspaceOrder(sessions, registry({ pinnedSessionIds: ['pin'] }), view({ orderBy: 'updated' }))).toEqual(['pin', 'a', 'b'])
  })
  it('keeps the selected blank first, omits other blanks and subagents, and retains archive positions', () => {
    const sessions = list([row('old', 1), row('blank', 2, { blank: true }), row('current', 3, { blank: true, retainedBy: { mainView: 1 } }), row('agent', 9, { origin: 'subagent' }), row('archive', 4)])
    const result = workspaceOrder(sessions, registry({ archivedSessionIds: ['archive'] }), view({ groupBy: 'flat', sessionOrderByAccount: { __flat_session_order__: ['old', 'archive'] } }))
    expect(result).toEqual(['current', 'old', 'archive'])
  })
  it('uses each account order and Host workspace order independently of folded sections', () => {
    const sessions = list([row('a', 1), row('b', 2), row('c', 3), row('loose', 4)])
    const workspaces = registry({ items: [{ workspaceId: 'w2', path: '/b', sessionIds: ['c'] }, { workspaceId: 'w1', path: '/a', sessionIds: ['a', 'b'] }] })
    expect(workspaceOrder(sessions, workspaces, view({ groupExpansion: { w1: false }, sessionOrderByAccount: { w1: ['a', 'b'] } }))).toEqual(['c', 'a', 'b', 'loose'])
    expect(workspaceOrder(sessions, workspaces, view({ groupBy: 'flat', sessionOrderByAccount: { __flat_session_order__: ['b', 'c', 'a'] } }))).toEqual(['b', 'c', 'a', 'loose'])
  })
  it('puts nested workspace rows before parent rows in tree mode without matching sibling prefixes', () => {
    const sessions = list([row('parent', 1), row('nested', 2), row('sibling', 3)])
    const workspaces = registry({ items: [{ workspaceId: 'p', path: '/a', sessionIds: ['parent'] }, { workspaceId: 's', path: '/abc', sessionIds: ['sibling'] }, { workspaceId: 'c', path: '/a/child', sessionIds: ['nested'] }] })
    expect(workspaceOrder(sessions, workspaces, view({ groupBy: 'workspace-tree' }))).toEqual(['nested', 'parent', 'sibling'])
  })
  it('terminates for cyclic source metadata without dropping members', () => {
    const sessions = list([row('a', 1, { parentId: 'b' }), row('b', 2, { parentId: 'a' })])
    expect(new Set(workspaceOrder(sessions, registry(), view()))).toEqual(new Set(['a', 'b']))
  })
})

it('attaches to an existing public root store across owner load, unload and replacement', async () => {
  const { SlotCore } = await import('@deepseek-ai/dsh-client-ui-slots')
  const { registerWorkspaceAdapter } = await import('../src/client/workspace-adapter.js')
  const slots: any = new SlotCore()
  slots.register({ name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' }, 'sidebar.workspaces': { kind: 'single', scope: 'root' } } }, () => null)
  slots.inject = (name: string, callback: () => () => void) => {
    let stop: (() => void) | undefined
    const sync = () => { stop?.(); stop = slots.spec(name) ? callback() : undefined }
    const unsub = slots.subscribeDeclaration(name, sync)
    sync()
    return () => { unsub(); stop?.() }
  }
  const adapter = registerWorkspaceAdapter({ slots } as any, {} as any)
  expect(slots.entriesOfSlot('shell.overlay')).toHaveLength(0)
  const handle = { spec: {}, create: () => { throw new Error('plugin must not create native instances') } }
  const stopOwner = slots.register({ name: 'sidebar.workspaces', store: handle }, () => null)
  await Promise.resolve()
  expect(slots.entriesOfSlot('shell.overlay')[0].store).toBe(handle)
  stopOwner(); await Promise.resolve()
  expect(slots.entriesOfSlot('shell.overlay')).toHaveLength(0)
  const replacement = { ...handle }
  const stopReplacement = slots.register({ name: 'sidebar.workspaces', store: replacement }, () => null)
  await Promise.resolve()
  expect(slots.entriesOfSlot('shell.overlay')[0].store).toBe(replacement)
  adapter.dispose()
  expect(slots.entriesOfSlot('shell.overlay')).toHaveLength(0)
  stopReplacement()
})

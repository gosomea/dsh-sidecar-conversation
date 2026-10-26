import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { modernSidecarHostApi } from '../src/host/modern-api.js'

describe('current Session Controller boundary', () => {
  it('keeps a child runnable instead of archiving it', async () => {
    const unarchiveSession = vi.fn(async () => undefined)
    const archiveSession = vi.fn()
    const api = modernSidecarHostApi({ workspaceRegistry: { unarchiveSession, archiveSession } } as unknown as Context)
    await api.workspace.ensureUsable({ payload: { sessionId: 'child' } } as never)
    expect(unarchiveSession).toHaveBeenCalledWith('child')
    expect(archiveSession).not.toHaveBeenCalled()
  })
  it('preserves the durable request ID when adapting prompt retries', async () => {
    const prompt = vi.fn(async () => ({ accepted: true }))
    const api = modernSidecarHostApi({ sessionController: { prompt } } as unknown as Context)
    const payload = { sessionId: 'child', mode: 'queue', content: [{ type: 'text', text: 'question' }] }
    await api.sessions.prompt({ rpcId: 'stable-id', payload } as never)
    expect(prompt).toHaveBeenCalledWith({ ...payload, requestId: 'stable-id' }, expect.any(AbortSignal))
  })
})

it('creates an unattached root Session with the source cwd, outside native blank reuse', async () => {
  const create = vi.fn(async () => ({ sessionId: 'new' }))
  const readSession = vi.fn(async () => ({ session: { cwd: '/test' }, events: [{ type: 'assistant/message' }] }))
  const api = modernSidecarHostApi({ sessionController: { create }, sessionQuery: { readSession }, workspaceRegistry: { list: () => [{ id: 'workspace', sessionIds: ['parent'] }] } } as unknown as Context)
  await api.sessions.createIndependent({ payload: { parentSessionId: 'parent', sessionId: 'new' } } as never)
  expect(create).toHaveBeenCalledWith({ sessionId: 'new', cwd: '/test' })
  expect(readSession).toHaveBeenCalledWith('parent')
})

it('reads native log events without the removed Controller inspect API or activating an Agent', async () => {
  const events = [{ seq: 1, type: 'assistant/message', data: { text: 'source' } }]
  const readSession = vi.fn(async () => ({ session: { cwd: '/test' }, events }))
  const resolveAgent = vi.fn()
  const api = modernSidecarHostApi({ sessionQuery: { readSession }, sessionController: { resolveAgent } } as unknown as Context)
  const response = await api.sessions.history({ rpcId: 'read', payload: { sessionId: 'parent', maxMessages: 100 } } as never)
  expect(response).toEqual({ result: { ok: true, value: { events: events.map(event => ({ event })), hasMore: false } } })
  expect(readSession).toHaveBeenCalledWith('parent')
  expect(resolveAgent).not.toHaveBeenCalled()
})

function workspaceFixture(events: any[], member = true) {
  const workspace = { id: 'workspace', path: '/test', sessionIds: member ? ['parent', 'child'] : ['parent'],
    detachSession: vi.fn(async (id: string) => { workspace.sessionIds = workspace.sessionIds.filter(x => x !== id) }),
    attachSession: vi.fn(async (id: string) => { workspace.sessionIds.push(id) }),
  }
  const readSession = vi.fn(async () => ({ session: { cwd: '/test' }, events }))
  const api = modernSidecarHostApi({ sessionQuery: { readSession }, workspaceRegistry: { list: () => [workspace] } } as unknown as Context)
  const reconcile = (attach = true) => api.workspace.reconcileSidecar({ rpcId: 'test', payload: { parentSessionId: 'parent', childSessionId: 'child', attach } } as never)
  return { api, workspace, reconcile }
}
it('removes legacy empty sidecars from reuse candidates without changing their permission events', async () => {
  const events = [{ type: 'permission/preset', data: { preset: 'danger-full-access' } },
    { type: 'sandbox/mode', data: { mode: 'read-only' } }, { type: 'approval/policy', data: { policy: 'never' } }]
  const before = JSON.stringify(events)
  const f = workspaceFixture(events)
  await f.reconcile(); await f.reconcile()
  expect(f.workspace.sessionIds).toEqual(['parent'])
  expect(f.workspace.detachSession).toHaveBeenCalledOnce()
  expect(JSON.stringify(events)).toBe(before)
})
it('attaches a started sidecar once, including failed turns, without changing main-session membership', async () => {
  const f = workspaceFixture([{ type: 'turn/start' }, { type: 'turn/error' }], false)
  await f.reconcile(); await f.reconcile()
  expect(f.workspace.sessionIds).toEqual(['parent', 'child'])
  expect(f.workspace.attachSession).toHaveBeenCalledOnce()
  expect(f.workspace.detachSession).not.toHaveBeenCalled()
})
it('does not detach an existing fork containing turns', async () => {
  const f = workspaceFixture([{ type: 'turn/start' }])
  await f.reconcile()
  expect(f.workspace.detachSession).not.toHaveBeenCalled()
  expect(f.workspace.attachSession).not.toHaveBeenCalled()
})

it('does not reattach a sent sidecar the user intentionally ungrouped', async () => {
  const f = workspaceFixture([{ type: 'turn/start' }], false)
  await f.reconcile(false)
  expect(f.workspace.attachSession).not.toHaveBeenCalled()
})

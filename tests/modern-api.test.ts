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

it('creates a root Session in the source workspace without copying history', async () => {
  const create = vi.fn(async () => ({ sessionId: 'new' }))
  const inspect = vi.fn(async () => ({ meta: { cwd: '/test' }, events: [{ type: 'assistant/message' }] }))
  const api = modernSidecarHostApi({ sessionController: { create, inspect }, workspaceRegistry: { list: () => [{ id: 'workspace', sessionIds: ['parent'] }] } } as unknown as Context)
  await api.sessions.createIndependent({ payload: { parentSessionId: 'parent', sessionId: 'new' } } as never)
  expect(create).toHaveBeenCalledWith({ sessionId: 'new', workspaceId: 'workspace' })
})

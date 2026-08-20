import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionFace, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import {
  SidecarController,
  type NativeConversationService,
  type NativeConversationSurfaceHandle,
} from '../src/client/controller.js'
import { wrapFirstQuestion } from '../src/core/quote.js'
import type { SidecarRecord } from '../src/core/types.js'

const record: SidecarRecord = {
  parentSessionId: 'parent', childSessionId: 'child', requestKey: 'create',
  sourceMessageId: 'assistant', sourceSeq: 10, sourceKind: 'selection', quote: 'quoted text',
  firstQuestion: 'why?', firstPromptRpcId: 'first-rpc', access: { mode: 'read-only' },
  title: 'title', createdAt: 1, updatedAt: 1, status: 'active',
}

function sessionFace(initialNodes: unknown[] = []) {
  let nodes = initialNodes
  const listeners = new Set<() => void>()
  const cancel = vi.fn(async () => ({ ok: true, value: { accepted: true } }))
  const session = {
    cancel,
    getSnapshot: () => ({ nodes }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  } as unknown as SessionFace
  return {
    session,
    cancel,
    publish(next: unknown[]) {
      nodes = next
      for (const listener of listeners) listener()
    },
  }
}

function runtimeFor(session: SessionFace) {
  const disposeLease = vi.fn()
  const acquireDetached = vi.fn(() => ({
    binding: { session },
    ready: Promise.resolve(),
    dispose: disposeLease,
  }))
  return {
    sessions: { acquireDetached } as unknown as SessionRuntime,
    acquireDetached,
    disposeLease,
  }
}

function surfaceService() {
  const update = vi.fn()
  const disposeSurface = vi.fn()
  const handle: NativeConversationSurfaceHandle = { update, dispose: disposeSurface }
  const mountSurface = vi.fn(() => handle)
  return {
    conversation: { mountSurface } as NativeConversationService,
    mountSurface,
    update,
    disposeSurface,
  }
}

function emptyConnection(): ConnectionHandle {
  return { api: { sessions: { history: vi.fn() } } } as unknown as ConnectionHandle
}

describe('native conversation surface', () => {
  it('mounts the native text-only surface without changing the current Session', async () => {
    const face = sessionFace()
    const runtime = runtimeFor(face.session)
    const native = surfaceService()
    const controller = new SidecarController(emptyConnection(), runtime.sessions, () => native.conversation)
    const prompt = vi.spyOn(controller, 'prompt').mockResolvedValue()
    const container = {} as HTMLElement

    const dispose = await controller.mountNativeSurface(record, container)

    expect(runtime.acquireDetached).toHaveBeenCalledWith('child')
    expect(native.mountSurface).toHaveBeenCalledOnce()
    const target = native.mountSurface.mock.calls[0]?.[0]
    expect(target).toMatchObject({
      sessionId: 'child', afterSeq: 10, container,
      header: false, composer: true,
      hiddenContextPlugins: ['@deepseek-ai/dsh-system-prompt'],
      pendingUserMessages: [],
      input: { textOnly: true, placeholder: '继续在侧边提问…' },
    })
    expect(target?.transformUserText?.(wrapFirstQuestion('quote', 'actual question'))).toBe('actual question')
    await target?.input?.submit('follow up')
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ childSessionId: 'child', question: 'follow up' }))
    await target?.input?.cancel?.()
    expect(face.cancel).toHaveBeenCalledOnce()

    dispose()
    dispose()
    expect(native.disposeSurface).toHaveBeenCalledOnce()
    expect(runtime.disposeLease).toHaveBeenCalledOnce()
  })

  it('renders accepted prompts optimistically and removes them when durable history carries the rpc id', async () => {
    const face = sessionFace()
    const runtime = runtimeFor(face.session)
    const native = surfaceService()
    const controller = new SidecarController(emptyConnection(), runtime.sessions, () => native.conversation)
    controller.store.addOptimistic({ childSessionId: 'child', requestKey: 'pending-1', question: 'visible now' })
    controller.store.ackOptimistic('child', 'pending-1', 'rpc-1')

    const dispose = await controller.mountNativeSurface(record, {} as HTMLElement)

    expect(native.mountSurface.mock.calls[0]?.[0].pendingUserMessages).toEqual([
      { id: 'pending-1', text: 'visible now' },
    ])
    face.publish([{ kind: 'user', source: { kind: 'user', rpcId: 'rpc-1' } }])
    expect(controller.store.getSnapshot().optimisticByChild.child).toEqual([])
    expect(native.update).toHaveBeenLastCalledWith({ pendingUserMessages: [] })
    dispose()
  })

  it('resolves the conversation service lazily when the provider registers after apply', async () => {
    const face = sessionFace()
    const runtime = runtimeFor(face.session)
    const native = surfaceService()
    let conversation: NativeConversationService | undefined
    const controller = new SidecarController(emptyConnection(), runtime.sessions, () => conversation)
    conversation = native.conversation

    await controller.mountNativeSurface(record, {} as HTMLElement)

    expect(native.mountSurface).toHaveBeenCalledOnce()
  })

  it('mounts directly from the fork point without polling durable history', async () => {
    const face = sessionFace([{ kind: 'assistant', seq: 10, source: { kind: 'model' } }])
    const runtime = runtimeFor(face.session)
    const native = surfaceService()
    const history = vi.fn()
    const controller = new SidecarController(
      { api: { sessions: { history } } } as unknown as ConnectionHandle,
      runtime.sessions,
      () => native.conversation,
    )

    await controller.mountNativeSurface(record, {} as HTMLElement)

    expect(history).not.toHaveBeenCalled()
    expect(native.mountSurface.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'child', afterSeq: 10 })
  })

  it('releases the detached lease when native mounting fails', async () => {
    const face = sessionFace()
    const runtime = runtimeFor(face.session)
    const conversation = {
      mountSurface: vi.fn(() => { throw new Error('mount failed') }),
    } as unknown as NativeConversationService
    const controller = new SidecarController(emptyConnection(), runtime.sessions, () => conversation)

    await expect(controller.mountNativeSurface(record, {} as HTMLElement)).rejects.toThrow('mount failed')
    expect(runtime.disposeLease).toHaveBeenCalledOnce()
  })
})

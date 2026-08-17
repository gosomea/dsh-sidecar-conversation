import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SidecarRecord } from '../src/core/types.js'
import { SidecarAccessController } from '../src/host/access.js'
import type { SidecarRegistry } from '../src/host/registry.js'

function fixture() {
  const events: Array<{ type: string; data: Record<string, unknown> }> = []
  const session = {
    id: 'child',
    events,
    append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }) },
  }
  let guard: ((exec: { agent?: { id: string } }) => string | undefined) | undefined
  const ctx = {
    sessions: { get: (id: string) => id === 'child' ? session : undefined },
    sandboxPolicy: {
      resolve: () => ({
        mode: [...events].reverse().find(event => event.type === 'sandbox/mode')?.data.mode ?? 'workspace-write',
        workspaceRoot: '/tmp/workspace',
      }),
    },
    tools: { guard: (next: typeof guard) => { guard = next; return () => { guard = undefined } } },
  } as unknown as Context
  let record: SidecarRecord = {
    parentSessionId: 'parent', childSessionId: 'child', requestKey: 'request',
    sourceMessageId: 'message', sourceSeq: 1, quote: '', firstQuestion: 'question', firstPromptRpcId: 'rpc',
    access: { mode: 'read-only' }, title: 'title', createdAt: 1, updatedAt: 1, status: 'active',
  }
  const registry = { getByChild: (id: string) => id === 'child' ? record : undefined } as SidecarRegistry
  return { controller: new SidecarAccessController(ctx, registry), events, guard: () => guard, setRecord: (next: SidecarRecord) => { record = next } }
}

describe('SidecarAccessController', () => {
  it('pins read-only sandbox and never-approval as durable session events', () => {
    const { controller, events } = fixture()
    expect(controller.apply('child', 'read-only')).toEqual({
      mode: 'read-only', effectiveSandbox: 'read-only', effectiveApproval: 'never',
    })
    expect(events.map(event => event.type)).toEqual(['sandbox/mode', 'approval/policy'])
  })

  it('fails closed at the tool boundary if a read-only policy drifts', () => {
    const { controller, events, guard } = fixture()
    const snapshot = controller.apply('child', 'read-only')
    controller.registerGuard()
    events.push({ type: 'sandbox/mode', data: { mode: 'danger-full-access' } })
    expect(guard()?.({ agent: { id: 'child' } })).toMatch(/denied/)
    expect(() => controller.assert({
      parentSessionId: 'parent', childSessionId: 'child', requestKey: 'request',
      sourceMessageId: 'message', sourceSeq: 1, quote: '', firstQuestion: 'question', firstPromptRpcId: 'rpc',
      access: snapshot, title: 'title', createdAt: 1, updatedAt: 1, status: 'active',
    })).toThrow(/只读策略未生效/)
  })
})

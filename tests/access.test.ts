import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SidecarRecord } from '../src/core/types.js'
import { SidecarAccessController } from '../src/host/access.js'

function fixture() {
  const events: Array<{ type: string; data: Record<string, unknown> }> = []
  const session = {
    id: 'child',
    events,
    append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }) },
  }
  const ctx = {
    sessions: { get: (id: string) => id === 'child' ? session : id === 'parent' ? { id: 'parent' } : undefined },
    approval: { overrideOf: (value: { id: string }) => value.id === 'parent' ? 'never' : [...events].reverse().find(event => event.type === 'approval/policy')?.data.policy },
    sandboxPolicy: {
      resolve: ({ session: value }: { session: { id: string } }) => ({
        mode: value.id === 'parent' ? 'read-only' : [...events].reverse().find(event => event.type === 'sandbox/mode')?.data.mode ?? 'workspace-write',
        workspaceRoot: '/tmp/workspace',
      }),
    },
  } as unknown as Context
  return { controller: new SidecarAccessController(ctx), events }
}

describe('SidecarAccessController', () => {
  it('pins read-only sandbox and never-approval as durable session events', () => {
    const { controller, events } = fixture()
    expect(controller.apply('child', 'read-only')).toEqual({
      mode: 'read-only', effectiveSandbox: 'read-only', effectiveApproval: 'never',
    })
    expect(events.map(event => event.type)).toEqual(['sandbox/mode', 'approval/policy'])
  })

  it('validates the initial read-only policy before provisioning completes', () => {
    const { controller, events } = fixture()
    const snapshot = controller.apply('child', 'read-only')
    events.push({ type: 'sandbox/mode', data: { mode: 'danger-full-access' } })
    expect(() => controller.assert({
      parentSessionId: 'parent', childSessionId: 'child', requestKey: 'request',
      sourceMessageId: 'message', sourceSeq: 1, quote: '', firstQuestion: 'question', firstPromptRpcId: 'rpc',
      access: snapshot, title: 'title', createdAt: 1, updatedAt: 1, status: 'provisioning',
    })).toThrow(/只读策略未生效/)
  })
})

it('copies the source permission policy without copying its message history', () => {
  const { controller, events } = fixture()
  expect(controller.apply('child', 'inherit', 'parent')).toEqual({ mode: 'inherit', effectiveSandbox: 'read-only', effectiveApproval: 'never' })
  expect(events.map(event => event.type)).toEqual(['sandbox/mode', 'approval/policy'])
})

it.each([true, false])('delegates active native and legacy sessions to DSH permissions (nativeComposer=%s)', nativeComposer => {
  const { controller } = fixture()
  expect(() => controller.assert({ nativeComposer, status: 'active', access: { mode: 'read-only' } } as SidecarRecord)).not.toThrow()
})

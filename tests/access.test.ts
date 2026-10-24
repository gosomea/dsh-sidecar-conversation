import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SidecarRecord } from '../src/core/types.js'
import { SidecarAccessController } from '../src/host/access.js'

function fixture() {
  const presets: Record<string, { sandbox: string; approval: string }> = {
    'read-only': { sandbox: 'read-only', approval: 'ask' },
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    auto: { sandbox: 'danger-full-access', approval: 'ask' },
  }
  const sessions = new Map(['parent', 'child'].map(id => [id, {
    id, events: [] as Array<{ type: string; data: Record<string, unknown> }>,
    append(type: string, data: Record<string, unknown>) { this.events.push({ type, data }) },
  }]))
  const fact = (id: string, type: string, field: string, fallback: string) => sessions.get(id)!.events.findLast(e => e.type === type)?.data[field] as string ?? fallback
  const resolve = vi.fn((name: string) => { if (!presets[name]) throw new Error('missing native preset'); return presets[name]! })
  const set = vi.fn((session: { id: string }, name: string) => {
    const spec = resolve(name)
    const target = sessions.get(session.id)!
    target.append('permission/preset', { preset: name })
    target.append('sandbox/mode', { mode: spec.sandbox })
    target.append('approval/policy', { policy: spec.approval })
  })
  const current = vi.fn((session: { id: string }) => fact(session.id, 'permission/preset', 'preset', 'workspace-write'))
  const ctx = {
    sessions: { get: (id: string) => sessions.get(id) },
    permissionPresets: { resolve, set, current },
    approval: { config: { policy: 'ask' }, overrideOf: (s: { id: string }) => fact(s.id, 'approval/policy', 'policy', 'ask') },
    sandboxPolicy: { resolve: ({ session }: { session: { id: string } }) => ({ mode: fact(session.id, 'sandbox/mode', 'mode', 'workspace-write') }) },
  } as unknown as Context
  return { controller: new SidecarAccessController(ctx), sessions, set, current, presets }
}

describe('native sidecar permission presets', () => {
  it('initializes the native read-only preset, including its approval policy', () => {
    const f = fixture()
    expect(f.controller.apply('child', 'read-only')).toEqual({ mode: 'read-only', effectiveSandbox: 'read-only', effectiveApproval: 'ask' })
    expect(f.set).toHaveBeenCalledWith(f.sessions.get('child'), 'read-only')
    expect(f.sessions.get('parent')!.events).toEqual([])
  })
  it('uses the deployment preset bundle instead of hard-coding approval settings', () => {
    const f = fixture(); f.presets['read-only']!.approval = 'never'
    expect(f.controller.apply('child', 'read-only').effectiveApproval).toBe('never')
  })
  it('refuses a read-only name that would grant write access', () => {
    const f = fixture(); f.presets['read-only']!.sandbox = 'danger-full-access'
    expect(() => f.controller.apply('child', 'read-only')).toThrow(/只读/)
    expect(f.set).not.toHaveBeenCalled()
  })
  it.each(['read-only', 'workspace-write', 'danger-full-access', 'auto'])('inherits the current main-session %s identity rather than old fork permissions', preset => {
    const f = fixture(); f.set(f.sessions.get('parent')!, preset); f.set.mockClear()
    f.controller.apply('child', 'inherit', 'parent')
    expect(f.set).toHaveBeenCalledWith(f.sessions.get('child'), preset)
    expect(f.sessions.get('child')!.events.find(e => e.type === 'permission/preset')?.data.preset).toBe(preset)
  })
  it('keeps subsequent child and parent changes independent', () => {
    const f = fixture(); f.set(f.sessions.get('parent')!, 'danger-full-access')
    f.controller.apply('child', 'inherit', 'parent')
    f.set(f.sessions.get('child')!, 'workspace-write')
    f.set(f.sessions.get('parent')!, 'read-only')
    f.controller.assert({ status: 'active', childSessionId: 'child', access: { mode: 'read-only' } } as SidecarRecord)
    expect(f.current(f.sessions.get('child')!)).toBe('workspace-write')
    expect(f.current(f.sessions.get('parent')!)).toBe('read-only')
  })
  it('copies genuine custom parent facts without inventing a selectable custom preset', () => {
    const f = fixture(); f.current.mockReturnValue('custom')
    const source = f.sessions.get('parent')!
    source.append('sandbox/mode', { mode: 'read-only' }); source.append('approval/policy', { policy: 'never' })
    expect(f.controller.apply('child', 'inherit', 'parent')).toEqual({ mode: 'inherit', effectiveSandbox: 'read-only', effectiveApproval: 'never' })
    expect(f.set).not.toHaveBeenCalled()
  })
  it('validates initial read-only state but leaves active native changes alone', () => {
    const f = fixture(); const access = f.controller.apply('child', 'read-only')
    f.sessions.get('child')!.append('sandbox/mode', { mode: 'danger-full-access' })
    const record = { status: 'provisioning', childSessionId: 'child', access } as SidecarRecord
    expect(() => f.controller.assert(record)).toThrow(/只读/)
    expect(() => f.controller.assert({ ...record, status: 'active' })).not.toThrow()
  })
})

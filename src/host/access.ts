import type { Context } from '@deepseek-ai/cordis'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { SidecarAccessMode, SidecarAccessSnapshot, SidecarRecord } from '../core/types.js'

export interface SidecarAccessBoundary {
  apply(childSessionId: string, mode: SidecarAccessMode, parentSessionId?: string): SidecarAccessSnapshot
  assert(record: SidecarRecord): void
}

/** Initializes native permission facts; subsequent edits belong to DSH. */
export class SidecarAccessController implements SidecarAccessBoundary {
  constructor(private readonly ctx: Context) {}

  apply(childSessionId: string, mode: SidecarAccessMode, parentSessionId?: string): SidecarAccessSnapshot {
    const session = this.session(childSessionId)
    if (mode === 'inherit' && parentSessionId !== undefined) {
      const source = this.inspect(parentSessionId, mode)
      setSandboxMode(session, source.effectiveSandbox!)
      setApprovalPolicy(session, source.effectiveApproval!)
    }
    if (mode === 'read-only') {
      const current = this.inspect(childSessionId, mode)
      if (current.effectiveSandbox !== 'read-only') setSandboxMode(session, 'read-only')
      if (current.effectiveApproval !== 'never') setApprovalPolicy(session, 'never')
    }
    return this.inspect(childSessionId, mode)
  }

  assert(record: SidecarRecord): void {
    if (record.status !== 'provisioning' || record.access.mode !== 'read-only') return
    const actual = this.inspect(record.childSessionId, record.access.mode)
    if (actual.effectiveSandbox !== 'read-only' || actual.effectiveApproval !== 'never') {
      throw new Error('Sidecar 只读策略未生效，已拒绝继续执行')
    }
  }

  private inspect(childSessionId: string, mode: SidecarAccessMode): SidecarAccessSnapshot {
    const session = this.session(childSessionId)
    return {
      mode,
      effectiveSandbox: this.ctx.sandboxPolicy.resolve({ session }).mode,
      effectiveApproval: this.ctx.approval.overrideOf(session) ?? 'ask',
    }
  }

  private session(childSessionId: string) {
    // Host and browser entrypoints share one declaration build; the browser
    // runtime also calls its client facade `sessions`, so keep this host cast
    // local instead of leaking the cross-platform name collision.
    const sessions = (this.ctx as unknown as { sessions: SessionStore }).sessions
    const session = sessions.get(childSessionId as SessionId)
    if (session === undefined) throw new Error(`Sidecar Session ${childSessionId} is not loaded`)
    return session
  }
}

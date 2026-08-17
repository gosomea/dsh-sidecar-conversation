import type { Context } from '@deepseek-ai/cordis'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { effectiveApprovalPolicy, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-tools'
import type { SidecarAccessMode, SidecarAccessSnapshot, SidecarRecord } from '../core/types.js'
import type { SidecarRegistry } from './registry.js'

export interface SidecarAccessBoundary {
  apply(childSessionId: string, mode: SidecarAccessMode): SidecarAccessSnapshot
  assert(record: SidecarRecord): void
}

/** Owns the durable permission facts and the last fail-closed tool boundary. */
export class SidecarAccessController implements SidecarAccessBoundary {
  constructor(private readonly ctx: Context, private readonly registry: SidecarRegistry) {}

  apply(childSessionId: string, mode: SidecarAccessMode): SidecarAccessSnapshot {
    const session = this.session(childSessionId)
    if (mode === 'read-only') {
      const current = this.inspect(childSessionId, mode)
      if (current.effectiveSandbox !== 'read-only') setSandboxMode(session, 'read-only')
      if (current.effectiveApproval !== 'never') setApprovalPolicy(session, 'never')
    }
    return this.inspect(childSessionId, mode)
  }

  assert(record: SidecarRecord): void {
    if (record.access.mode !== 'read-only') return
    const actual = this.inspect(record.childSessionId, record.access.mode)
    if (actual.effectiveSandbox !== 'read-only' || actual.effectiveApproval !== 'never') {
      throw new Error('Sidecar 只读策略未生效，已拒绝继续执行')
    }
  }

  registerGuard(): () => void {
    return this.ctx.tools.guard(exec => {
      const sessionId = exec.agent?.id
      if (sessionId === undefined) return undefined
      const record = this.registry.getByChild(String(sessionId))
      if (record?.access.mode !== 'read-only') return undefined
      try {
        this.assert(record)
        return undefined
      } catch {
        return 'Sidecar read-only policy is not effective; tool execution is denied.'
      }
    })
  }

  private inspect(childSessionId: string, mode: SidecarAccessMode): SidecarAccessSnapshot {
    const session = this.session(childSessionId)
    return {
      mode,
      effectiveSandbox: this.ctx.sandboxPolicy.resolve({ session }).mode,
      effectiveApproval: effectiveApprovalPolicy(session.events) ?? 'ask',
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

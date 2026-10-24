import type { Context } from '@deepseek-ai/cordis'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SidecarHostApi } from './sidecar-service.js'

function ok<T>(value: T): { result: { ok: true; value: T } } {
  return { result: { ok: true, value } }
}

/** Use native Session commands and cold-safe query snapshots for Sidecar. */
export function modernSidecarHostApi(ctx: Context): SidecarHostApi {
  return {
    sessions: {
      createIndependent: async ({ payload }) => {
        const source = await ctx.sessionQuery.readSession(payload.parentSessionId)
        if (source.session.cwd === undefined) throw new Error('Cannot create independent session without source workspace')
        const workspace = ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(payload.parentSessionId))
        return ok(await ctx.sessionController.create({ sessionId: payload.sessionId,
          ...(workspace === undefined ? { cwd: source.session.cwd } : { workspaceId: workspace.id }),
        }))
      },
      fork: async ({ payload }) => ok(await ctx.sessionController.fork(payload)),
      rename: async ({ payload }) => ok(await ctx.sessionController.rename(payload)),
      prompt: async ({ rpcId, payload }) => ok(await ctx.sessionController.prompt({
        requestId: rpcId as SessionRequestId,
        sessionId: payload.sessionId,
        mode: payload.mode,
        content: payload.content,
      }, new AbortController().signal)),
      history: async ({ payload }) => {
        const inspected = await ctx.sessionQuery.readSession(payload.sessionId)
        return ok({ events: inspected.events.map(event => ({ event })), hasMore: false })
      },
      models: async ({ payload }) => {
        const resolved = await ctx.sessionController.resolveAgent(payload.sessionId)
        if ('error' in resolved) throw resolved.error
        return ok({ loaded: true })
      },
    },
    workspace: {
      ensureUsable: async ({ payload }) => {
        await ctx.workspaceRegistry.unarchiveSession(payload.sessionId)
        return ok({ archived: false })
      },
    },
  }
}

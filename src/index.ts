import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import { SidecarAccessController } from './host/access.js'
import { SidecarRegistry } from './host/registry.js'
import { registerRoutes } from './host/routes.js'
import { modernSidecarHostApi } from './host/modern-api.js'
import { SidecarService } from './host/sidecar-service.js'
import { SidecarSseBroker } from './host/sse.js'

export * from './core/types.js'
export { SidecarRegistry } from './host/registry.js'

export const name = 'sidecar-conversation'
export const inject = ['sessionController', 'workspaceRegistry', 'webServer', 'sessions', 'sandboxPolicy', 'approval', 'permissionPresets']

export async function apply(ctx: Context): Promise<void> {
  const registry = new SidecarRegistry()
  await registry.load()
  const access = new SidecarAccessController(ctx)
  const service = new SidecarService(modernSidecarHostApi(ctx), registry, access)
  await service.recoverRegistered()
  const broker = new SidecarSseBroker(ctx, registry)
  ctx.effect(() => {
    broker.start()
    const disposeNative = ctx.on('session/event', (session, event) => {
      void service.noteNativeEvent(String(session.id), event).catch(error => ctx.logger.warn('Sidecar title sync failed: %s', String(error)))
    })
    const disposeRoutes = registerRoutes(ctx.webServer, service, broker)
    return () => { disposeNative(); disposeRoutes(); broker.dispose() }
  }, 'sidecar-conversation: routes and event broker')
}

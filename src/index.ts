import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-tools'
import { SidecarAccessController } from './host/access.js'
import { SidecarRegistry } from './host/registry.js'
import { registerRoutes } from './host/routes.js'
import { SidecarService } from './host/sidecar-service.js'
import { SidecarSseBroker } from './host/sse.js'

export * from './core/types.js'
export { SidecarRegistry } from './host/registry.js'

export const name = 'sidecar-conversation'
export const inject = ['apiProxy', 'webServer', 'sessions', 'sandboxPolicy', 'approval', 'tools']

export async function apply(ctx: Context): Promise<void> {
  const registry = new SidecarRegistry()
  await registry.load()
  const access = new SidecarAccessController(ctx, registry)
  const service = new SidecarService(ctx.apiProxy, registry, access)
  const disposeGuard = access.registerGuard()
  await service.recoverRegistered()
  const broker = new SidecarSseBroker(ctx, registry)
  ctx.effect(() => {
    broker.start()
    const disposeRoutes = registerRoutes(ctx.webServer, service, broker)
    return () => { disposeRoutes(); broker.dispose(); disposeGuard() }
  }, 'sidecar-conversation: routes and event broker')
}

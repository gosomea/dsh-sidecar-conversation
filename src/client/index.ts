import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SidecarController } from './controller.js'
import { SidecarAction } from './components/SidecarAction.js'
import { SidecarDrawer } from './components/SidecarDrawer.js'

export const name = 'sidecar-conversation/client'
export const inject = ['slots', 'connection', 'sessions']

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as SessionRuntime
  const controller = new SidecarController(connection, sessions)

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'sidecar-conversation',
    order: 20,
    label: '侧问',
    inject: () => ({ controller }),
  }, SidecarAction))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sidecar-conversation',
    order: 40,
    label: 'Sidecar conversation',
    inject: () => ({ controller }),
  }, SidecarDrawer))
}

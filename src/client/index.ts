import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SidecarController } from './controller.js'
import { SidecarAction } from './components/SidecarAction.js'
import { SelectionOverlay } from './components/SelectionOverlay.js'
import { sidecarQuestionDisplay } from './question-display.js'
import { registerNativeSidebar } from './native-sidebar.js'

export const name = 'sidecar-conversation/client'
export const inject = ['slots', 'sessions', 'conversation', 'sidebarRight', 'sidebarRightTabs', 'uiSession', 'uiConversation', 'inputTriggers', 'uiWorkspace']

export function apply(ctx: Context): void {
  const controller = new SidecarController()
  ctx.effect(() => ctx.uiConversation.userText.register(sidecarQuestionDisplay), 'sidecar question display')
  ctx.effect(() => registerNativeSidebar(ctx, controller), 'sidecar native sidebar')
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'sidecar-conversation', order: 20,
    inject: () => ({ controller }),
  }, SidecarAction))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'sidecar-conversation-selection', order: 40,
    inject: () => ({ controller, hooks: { selectedSession: ctx.uiSession.adapter.current } }),
  }, SelectionOverlay))
}

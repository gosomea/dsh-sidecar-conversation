import { createElement } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SidecarController, type NativeConversationService } from './controller.js'
import { SidecarAction } from './components/SidecarAction.js'
import { SelectionOverlay } from './components/SelectionOverlay.js'
import { SidecarChatTab, SidecarHistoryTab } from './components/SidecarTabs.js'
import {
  registerSidecarTabs,
  resolveBetterSidebar,
  type BetterSidebarContext,
} from './better-sidebar.js'

export const name = 'sidecar-conversation/client'
export const inject = ['slots', 'connection', 'sessions', 'conversation']

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as SessionRuntime
  // Resolve at mount time so Conversation provider replacement (including
  // Harness client HMR) is observed instead of retaining a stale tracker.
  const resolveNativeConversation = (): NativeConversationService | undefined => {
    const conversation = ctx.get('conversation') as Partial<NativeConversationService> | undefined
    return typeof conversation?.mountSurface === 'function'
      ? conversation as NativeConversationService
      : undefined
  }
  const sidebarContext = ctx as unknown as BetterSidebarContext
  const controller = new SidecarController(
    connection,
    sessions,
    resolveNativeConversation,
    () => resolveBetterSidebar(sidebarContext),
  )

  ctx.effect(() => registerSidecarTabs(sidebarContext, {
    chat: props => createElement(SidecarChatTab, { ...props, controller }),
    history: props => createElement(SidecarHistoryTab, { ...props, controller }),
  }, service => {
    const unbind = controller.bindSidebar(service)
    // Migration runs only after both descriptors are registered. Stable ids
    // make it idempotent across HMR, and the legacy document stays untouched.
    controller.migrateLegacyTabs(service)
    return unbind
  }), 'sidecar-conversation Better Sidebar tabs')

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'sidecar-conversation',
    order: 20,
    label: '侧问',
    inject: () => ({ controller }),
  }, SidecarAction))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sidecar-conversation-selection',
    order: 40,
    label: 'Sidecar selection action',
    inject: () => ({ controller }),
  }, SelectionOverlay))
}

import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconNewChatOutlineMedium, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { findAssistantSource } from '../selection.js'
import type { SidecarController } from '../controller.js'
import css from './SidecarAction.module.css'

interface Injected { controller: SidecarController }
type Props = PropsRuntime<'conversation.chat.assistant-actions'> & InjectFace<Injected> & {
  sourceSeq?: number
  text?: string
}

/** Turn action and semantic marker used to associate a DOM selection with its finalized message. */
export function SidecarAction({ messageId, sessionId, sourceSeq, text, useChat, controller }: Props) {
  const [open, setOpen] = useState(false)
  useSyncExternalStore(controller.subscribeTargets, controller.getTargetRevision, controller.getTargetRevision)
  useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot)
  useEffect(() => { setOpen(false) }, [sessionId, messageId])
  const sidebarAvailable = useSyncExternalStore(
    controller.store.subscribe,
    () => controller.store.getSnapshot().sidebarAvailable,
    () => false,
  )
  const snapshot = useChat((value: ChatSnapshot) => ({ chat: value }))
  const marker = useRef<HTMLButtonElement>(null)
  const source = sourceSeq === undefined || text === undefined
    ? findAssistantSource(snapshot, String(messageId))
    : { sourceSeq, text }
  useEffect(() => {
    if (!sidebarAvailable || source === undefined) return
    return controller.registerAssistant(String(sessionId), {
      messageId: String(messageId), sourceSeq: source.sourceSeq, text: source.text,
      ...(marker.current === null ? {} : { marker: marker.current }),
    })
  }, [controller, messageId, sessionId, source?.sourceSeq, source?.text, sidebarAvailable])
  if (!sidebarAvailable || source === undefined) return null
  const parent = String(sessionId)
  const target = open ? controller.recentTarget?.(parent) : undefined
  const draft = { sourceKind: 'turn' as const, sourceMessageId: String(messageId), sourceSeq: source.sourceSeq,
    quote: '', question: '', accessMode: 'read-only' as const }
  return <Menu open={open} onClose={() => setOpen(false)} portal compact side="top"
    items={[
      ...(target ? [{ id: 'append', label: '追加到最近侧问' }] : []),
      { id: 'fork', label: '从此回合 Fork' },
      { id: 'independent', label: '仅用此回合新建' },
    ]}
    onSelect={id => {
      setOpen(false)
      if (id === 'append') {
        if (target) controller.addSource(parent, draft, target.id)
      } else if (id === 'fork' || id === 'independent') {
        controller.openDraft(parent, { ...draft, creationMode: id, creationConfirmed: true })
      }
    }}
    anchor={<Tooltip label="侧问这个回合" side="bottom">
    <button
      ref={marker}
      type="button"
      className={css.turnAction}
      data-sidecar-assistant-marker=""
      data-sidecar-session-id={String(sessionId)}
      data-sidecar-message-id={String(messageId)}
      data-sidecar-source-seq={source.sourceSeq}
      aria-label="侧问这个回合"
      aria-haspopup="menu"
      aria-expanded={open}
      onPointerDown={event => {
        // Keep the message row from handling the press. Do not prevent the
        // button's default pointer action: Tooltip primitives and browsers
        // may otherwise suppress the subsequent click entirely.
        event.stopPropagation()
      }}
      onClick={event => {
        event.stopPropagation()
        setOpen(value => !value)
        if (!open) void controller.load(parent)
      }}
    >
      <IconNewChatOutlineMedium />
    </button>
  </Tooltip>} />
}

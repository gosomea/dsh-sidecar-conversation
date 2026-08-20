import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconNewChatOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { findAssistantSource } from '../selection.js'
import type { SidecarController } from '../controller.js'
import css from './SidecarAction.module.css'

interface Injected { controller: SidecarController }
type Props = PropsRuntime<'conversation.chat.assistant-actions'> & InjectFace<Injected>

/** Turn action and semantic marker used to associate a DOM selection with its finalized message. */
export function SidecarAction({ messageId, sessionId, useSession, controller }: Props) {
  const sidebarAvailable = useSyncExternalStore(
    controller.store.subscribe,
    () => controller.store.getSnapshot().sidebarAvailable,
    () => false,
  )
  const snapshot = useSession(value => value)
  const marker = useRef<HTMLButtonElement>(null)
  const source = findAssistantSource(snapshot, String(messageId))
  useEffect(() => {
    if (source === undefined) return
    return controller.registerAssistant(String(sessionId), {
      messageId: String(messageId), sourceSeq: source.sourceSeq, text: source.text,
      ...(marker.current === null ? {} : { marker: marker.current }),
    })
  }, [controller, messageId, sessionId, source?.sourceSeq, source?.text])
  if (source === undefined || !sidebarAvailable) return null
  return <Tooltip label="侧问这个回合" side="bottom">
    <button
      ref={marker}
      type="button"
      className={css.turnAction}
      data-sidecar-assistant-marker=""
      data-sidecar-message-id={String(messageId)}
      data-sidecar-source-seq={source.sourceSeq}
      aria-label="侧问这个回合"
      onPointerDown={event => {
        // Keep the message row from handling the press. Do not prevent the
        // button's default pointer action: Tooltip primitives and browsers
        // may otherwise suppress the subsequent click entirely.
        event.stopPropagation()
      }}
      onClick={event => {
        event.stopPropagation()
        controller.openDraft(String(sessionId), {
          sourceKind: 'turn', sourceMessageId: String(messageId), sourceSeq: source.sourceSeq, quote: '', question: '', accessMode: 'read-only',
        })
      }}
    >
      <IconNewChatOutline16 />
    </button>
  </Tooltip>
}

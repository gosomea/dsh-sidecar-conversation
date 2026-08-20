import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidecarController } from '../controller.js'
import { assistantSelectionRow } from '../selection.js'
import css from './SelectionOverlay.module.css'

interface Injected { controller: SidecarController }
type Props = PropsRuntime<'shell.overlay'> & InjectFace<Injected>

interface SelectionMenuState {
  quote: string
  left: number
  top: number
  messageId: string
  sourceSeq: number
}

/**
 * Keeps the selection action outside the Better Sidebar surface. The captured
 * quote is frozen at pointer-up, so moving the pointer onto the action cannot
 * mutate or clear the source selection before the draft tab is opened.
 */
export function SelectionOverlay({ useSessions, controller }: Props) {
  const sidebarAvailable = useSyncExternalStore(
    controller.store.subscribe,
    () => controller.store.getSnapshot().sidebarAvailable,
    () => false,
  )
  const current = useSessions(state => state.current)
  const parentSessionId = current === undefined ? undefined : String(current)
  const [menu, setMenu] = useState<SelectionMenuState>()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (parentSessionId === undefined) {
      setMenu(undefined)
      return
    }

    let captureFrame = 0
    const clear = (): void => { setMenu(undefined) }
    const clearOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') clear() }
    const capture = (): void => {
      const selection = window.getSelection()
      if (!sidebarAvailable || selection === null || selection.isCollapsed || selection.rangeCount === 0) return
      const sourceRow = assistantSelectionRow(selection)
      if (sourceRow === undefined) return
      const quote = selection.toString().trim()
      if (!quote || quote.length > 4_000) return
      const candidate = controller.selectedAssistant(parentSessionId, quote, sourceRow)
      if (candidate === undefined) return
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      setMenu({
        quote,
        messageId: candidate.messageId,
        sourceSeq: candidate.sourceSeq,
        left: Math.min(window.innerWidth - 250, Math.max(12, rect.left + rect.width / 2 - 108)),
        top: Math.max(12, rect.top - 42),
      })
    }
    const scheduleCapture = (event?: Event): void => {
      if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent && !event.isPrimary) return
      if (event instanceof MouseEvent && event.button !== 0) return
      window.cancelAnimationFrame(captureFrame)
      captureFrame = window.requestAnimationFrame(capture)
    }
    const pointerStarted = (event: PointerEvent): void => {
      const action = menuRef.current
      if (action !== null && event.composedPath().includes(action)) return
      clear()
    }

    document.addEventListener('pointerdown', pointerStarted)
    document.addEventListener('pointerup', scheduleCapture)
    // Some Markdown/code renderers or browser selection paths consume the
    // PointerEvent while still delivering the legacy mouseup/selectionchange
    // signals. These fallbacks also make keyboard-created selections work.
    document.addEventListener('mouseup', scheduleCapture)
    document.addEventListener('selectionchange', scheduleCapture)
    window.addEventListener('wheel', clear, { capture: true, passive: true })
    window.addEventListener('keydown', clearOnEscape)
    return () => {
      window.cancelAnimationFrame(captureFrame)
      document.removeEventListener('pointerdown', pointerStarted)
      document.removeEventListener('pointerup', scheduleCapture)
      document.removeEventListener('mouseup', scheduleCapture)
      document.removeEventListener('selectionchange', scheduleCapture)
      window.removeEventListener('wheel', clear, true)
      window.removeEventListener('keydown', clearOnEscape)
    }
  }, [controller, parentSessionId, sidebarAvailable])

  if (menu === undefined || parentSessionId === undefined) return null
  return <div
    ref={menuRef}
    data-sidecar-selection-menu=""
    className={css.menu}
    style={{ left: menu.left, top: menu.top }}
    onPointerDownCapture={event => {
      // Do not let the browser start a second drag-selection while the user is
      // moving onto the action. `click` still fires and uses the frozen quote.
      event.preventDefault()
      event.stopPropagation()
    }}
  >
    <Button
      size="sm"
      variant="ghost"
      onPointerDown={event => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={() => {
        controller.openDraft(parentSessionId, {
          sourceKind: 'selection',
          sourceMessageId: menu.messageId,
          sourceSeq: menu.sourceSeq,
          quote: menu.quote,
          question: '',
          accessMode: 'read-only',
        })
        window.getSelection()?.removeAllRanges()
        setMenu(undefined)
      }}
    >在侧边栏提问</Button>
  </div>
}

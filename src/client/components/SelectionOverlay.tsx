import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidecarController } from '../controller.js'
import { assistantSelectionRow } from '../selection.js'
import css from './SelectionOverlay.module.css'

interface Injected { controller: SidecarController; hooks: { selectedSession: { subscribe: (fn: () => void) => () => void; getSnapshot: () => { key: string | undefined } } } }
type Props = PropsRuntime<'shell.overlay'> & InjectFace<Injected>

interface SelectionMenuState {
  parentSessionId: string
  quote: string
  left: number
  top: number
  bottom: number
  messageId: string
  sourceSeq: number
  sourceOffset: number
}

/**
 * Keeps the selection action outside the native sidebar surface. The captured
 * quote is frozen at pointer-up, so moving the pointer onto the action cannot
 * mutate or clear the source selection before the draft tab is opened.
 */
export function SelectionOverlay({ controller }: Props) {
  useSyncExternalStore(controller.subscribeTargets, controller.getTargetRevision, controller.getTargetRevision)
  useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot)
  const sidebarAvailable = useSyncExternalStore(
    controller.store.subscribe,
    () => controller.store.getSnapshot().sidebarAvailable,
    () => false,
  )
  const [menu, setMenu] = useState<SelectionMenuState>()
  const menuRef = useRef<HTMLDivElement>(null)

  const target = menu && controller.recentTarget?.(menu.parentSessionId)
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!menu || !el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 12
    const below = menu.bottom + 8
    const above = menu.top - height - 8
    const top = below + height <= window.innerHeight - margin ? below : above >= margin ? above
      : Math.max(margin, Math.min(below, window.innerHeight - height - margin))
    el.style.left = `${Math.max(margin, Math.min(menu.left - width / 2, window.innerWidth - width - margin))}px`
    el.style.top = `${top}px`
  }, [menu, target?.id])

  useEffect(() => {

    let captureFrame = 0
    const clear = (): void => { setMenu(undefined) }
    const clearOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') clear() }
    const capture = (): void => {
      const selection = window.getSelection()
      if (controller.selectionFromNavigation || !sidebarAvailable || selection === null || selection.isCollapsed || selection.rangeCount === 0) return
      const sourceRow = assistantSelectionRow(selection)
      if (sourceRow === undefined) return
      const quote = selection.toString().trim()
      if (!quote || quote.length > 4_000) return
      const source = controller.selectedSource(quote, sourceRow)
      if (source === undefined) return
      const { candidate, parentSessionId } = source
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      const before = selection.getRangeAt(0).cloneRange()
      before.selectNodeContents(sourceRow)
      before.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset)
      setMenu({
        sourceOffset: before.toString().length,
        parentSessionId, quote,
        messageId: candidate.messageId,
        sourceSeq: candidate.sourceSeq,
        left: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom,
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
      controller.selectionFromNavigation = false
      clear()
    }

    document.addEventListener('pointerdown', pointerStarted)
    document.addEventListener('pointerup', scheduleCapture, true)
    // Some Markdown/code renderers or browser selection paths consume the
    // PointerEvent while still delivering the legacy mouseup/selectionchange
    // signals. These fallbacks also make keyboard-created selections work.
    document.addEventListener('mouseup', scheduleCapture, true)
    document.addEventListener('selectionchange', scheduleCapture)
    window.addEventListener('wheel', clear, { capture: true, passive: true })
    window.addEventListener('keydown', clearOnEscape)
    window.addEventListener('resize', clear)
    return () => {
      window.cancelAnimationFrame(captureFrame)
      document.removeEventListener('pointerdown', pointerStarted)
      document.removeEventListener('pointerup', scheduleCapture, true)
      document.removeEventListener('mouseup', scheduleCapture, true)
      document.removeEventListener('selectionchange', scheduleCapture)
      window.removeEventListener('wheel', clear, true)
      window.removeEventListener('keydown', clearOnEscape)
      window.removeEventListener('resize', clear)
    }
  }, [controller, sidebarAvailable])

  if (menu === undefined) return null
  const selectedDraft = { sourceKind: 'selection' as const, sourceMessageId: menu.messageId, sourceSeq: menu.sourceSeq, sourceOffset: menu.sourceOffset, quote: menu.quote, question: '', accessMode: 'read-only' as const, creationMode: 'fork' as const }
  const close = () => { window.getSelection()?.removeAllRanges(); setMenu(undefined) }
  return <MenuSurface compact
    role="group" aria-label="选区侧问操作"
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
    {target && <Button size="sm" variant="ghost" className={css.action}
      onClick={() => { if (target) controller.addSource(menu.parentSessionId, selectedDraft, target.id); close() }}>
      追加到最近侧问
    </Button>}
    <Button size="sm" variant="ghost" className={css.action}
      onClick={() => { controller.openDraft(menu.parentSessionId, { ...selectedDraft, creationMode: 'independent', creationConfirmed: true }); close() }}>
      仅用选文新建
    </Button>
    <Button size="sm" variant="ghost" className={css.action}
      onClick={() => { controller.openDraft(menu.parentSessionId, { ...selectedDraft, creationMode: 'fork', creationConfirmed: true }); close() }}>
      从此回合 Fork
    </Button>
  </MenuSurface>
}

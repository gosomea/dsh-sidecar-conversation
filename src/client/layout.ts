import { useLayoutEffect, useState } from 'react'

export interface DrawerGeometry { top: number; left: number; width: number; height: number; full: boolean }

const SPLIT_ATTRIBUTE = 'sidecarConversationSplit'
const WIDTH_PROPERTY = '--dsh-sidecar-conversation-width'
const MOBILE_VIEWPORT_WIDTH = 720
const MIN_MAIN_CONVERSATION_WIDTH = 360

export function resolveConversationSplitWidth(
  hostWidth: number,
  requestedWidth: number,
  viewportWidth: number,
): Pick<DrawerGeometry, 'width' | 'full'> {
  const full = viewportWidth < MOBILE_VIEWPORT_WIDTH
  if (full) return { width: hostWidth, full: true }

  // A details/explorer plugin can make the conversation column narrow on a
  // large desktop viewport. Keep the two conversations visible in that case
  // instead of mistaking the narrowed column for a mobile layout.
  const availableBesideMain = hostWidth - MIN_MAIN_CONVERSATION_WIDTH
  const balancedWidth = hostWidth / 2
  const width = Math.max(0, Math.min(requestedWidth, Math.max(availableBesideMain, balancedWidth)))
  return { width, full: false }
}

export function releaseConversationSplit(target: HTMLElement | null): void {
  if (target === null) return
  delete target.dataset[SPLIT_ATTRIBUTE]
  target.style.removeProperty(WIDTH_PROPERTY)
  // Clean up inline properties left by versions before the data-attribute
  // layout contract. The transition signature makes this narrowly owned.
  if (target.style.transition.includes('padding-right')) {
    target.style.removeProperty('padding-right')
    target.style.removeProperty('box-sizing')
    target.style.removeProperty('transition')
  }
}

export function applyConversationSplit(target: HTMLElement, width: number): void {
  releaseConversationSplit(target)
  target.dataset[SPLIT_ATTRIBUTE] = 'true'
  target.style.setProperty(WIDTH_PROPERTY, `${width}px`)
}

function conversationHost(): HTMLElement | null {
  const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')
  return scroll?.parentElement ?? scroll
}

/** Reserve an internal lane in the conversation column without changing the shell/AionUI grid. */
export function useConversationGeometry(requestedWidth: number, active: boolean): DrawerGeometry | undefined {
  const [geometry, setGeometry] = useState<DrawerGeometry>()
  useLayoutEffect(() => {
    let host: HTMLElement | null = null
    let observer: ResizeObserver | undefined
    let mutation: MutationObserver | undefined
    const measure = (): void => {
      const next = conversationHost()
      if (next !== host) {
        releaseConversationSplit(host)
        observer?.disconnect()
        host = next
        if (host !== null) {
          observer = new ResizeObserver(measure)
          observer.observe(host)
        }
      }
      if (host === null) return
      const rect = host.getBoundingClientRect()
      const { full, width } = resolveConversationSplitWidth(rect.width, requestedWidth, window.innerWidth)
      if (active && !full) {
        applyConversationSplit(host, width)
      } else releaseConversationSplit(host)
      setGeometry({ top: rect.top, left: rect.right - width, width, height: rect.height, full })
    }
    measure()
    mutation = new MutationObserver(measure)
    mutation.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    return () => { releaseConversationSplit(host); observer?.disconnect(); mutation?.disconnect(); window.removeEventListener('resize', measure) }
  }, [requestedWidth, active])
  return geometry
}

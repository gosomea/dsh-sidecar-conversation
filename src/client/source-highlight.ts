import './source-highlight.module.css'

const NAME = 'dsh-sidecar-reference'
const DURATION = 3000

/** Resolve a rendered quote without confusing repeated text or Markdown layout whitespace. */
export function sourceRange(row: HTMLElement, quote: string, textOffset?: number): Range | undefined {
  if (!quote.trim()) return undefined
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const text = nodes.map(node => node.data).join('')
  const matches: Array<{ start: number; end: number }> = []
  for (let start = text.indexOf(quote); start >= 0; start = text.indexOf(quote, start + 1)) matches.push({ start, end: start + quote.length })
  let match = matches.find(item => item.start === textOffset)
  if (!match && matches.length === 1) match = matches[0]
  if (!match) {
    const positions: number[] = []
    let compact = ''
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i]!)) { positions.push(i); compact += text[i] }
    const needle = quote.replace(/\s/g, '')
    if (!needle) return undefined
    const normalized: Array<{ start: number; end: number }> = []
    for (let at = compact.indexOf(needle); at >= 0; at = compact.indexOf(needle, at + 1)) {
      normalized.push({ start: positions[at]!, end: positions[at + needle.length - 1]! + 1 })
    }
    match = normalized.find(item => item.start === textOffset) ?? (normalized.length === 1 ? normalized[0] : undefined)
  }
  if (!match) return undefined
  const range = document.createRange()
  let offset = 0
  let began = false
  for (const node of nodes) {
    if (!began && offset + node.length > match.start) { range.setStart(node, match.start - offset); began = true }
    if (began && offset + node.length >= match.end) { range.setEnd(node, match.end - offset); return range }
    offset += node.length
  }
  return undefined
}

/** One replaceable visual jump. It never takes the editor's DOM selection or modifies message content. */
export function createSourceHighlighter() {
  let dispose: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => { clearTimeout(timer); dispose?.(); dispose = undefined }
  const hold = (cleanup: () => void) => { dispose = cleanup; timer = setTimeout(clear, DURATION) }
  return {
    clear,
    selection(range: Range, row: HTMLElement) {
      clear()
      range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' })
      const first = range.getClientRects?.()[0]
      const scroller = row.closest<HTMLElement>('[data-conversation-scroll]')
      if (first && scroller) scroller.scrollBy({ top: first.top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2, behavior: 'instant' })
      if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
        const highlight = new Highlight(range)
        CSS.highlights.set(NAME, highlight)
        hold(() => { if (CSS.highlights.get(NAME) === highlight) CSS.highlights.delete(NAME) })
      } else {
        // Geometry-only fallback for browsers without CSS Highlights; message DOM stays owned by DSH.
        const overlay = document.createElement('div')
        overlay.className = 'dsh-sidecar-reference-overlay'
        overlay.setAttribute('aria-hidden', 'true')
        const paint = () => {
          overlay.replaceChildren(...Array.from(range.getClientRects()).map(rect => {
            const mark = document.createElement('span')
            Object.assign(mark.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
            return mark
          }))
        }
        document.body.append(overlay); paint()
        window.addEventListener('scroll', paint, true); window.addEventListener('resize', paint)
        hold(() => { overlay.remove(); window.removeEventListener('scroll', paint, true); window.removeEventListener('resize', paint) })
      }
    },
    turn(rows: readonly HTMLElement[]) {
      clear()
      rows[0]?.scrollIntoView({ block: 'center', behavior: 'instant' })
      const animations = rows.map(row => {
        row.dataset.sidecarTurnHighlight = row.dataset.chatTurn ?? ''
        return row.animate([{ backgroundColor: 'rgba(114,159,255,.35)' }, { backgroundColor: 'transparent' }], { duration: DURATION })
      })
      hold(() => { animations.forEach(animation => animation?.cancel()); rows.forEach(row => { delete row.dataset.sidecarTurnHighlight }) })
    },
  }
}
export type SourceHighlighter = ReturnType<typeof createSourceHighlighter>

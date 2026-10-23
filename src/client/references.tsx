import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { UserTextNodeProps, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SidecarController } from './controller.js'
import { parseReference, referenceLabel, type SidecarReference } from '../core/references.js'

export const SOURCE = 'sidecar-reference'
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap { 'sidecar-reference': SidecarReference }
}
export const referenceRule: UserTextRule<'sidecar-reference'> = {
  id: SOURCE, order: -10,
  match(text, from) {
    const pattern = /<sidecar_reference>([\s\S]*?)<\/sidecar_reference>/g
    pattern.lastIndex = from
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      try { return { id: SOURCE, start: m.index, end: m.index + m[0].length, data: parseReference(JSON.parse(m[1]!)) } }
      catch { /* Foreign or damaged tags stay visible as ordinary text. */ }
    }
    return undefined
  },
}

/** Native history paging owns data; this adapter only locates and highlights rendered source text. */
export async function revealReference(ctx: Context, reference: SidecarReference): Promise<void> {
  const id = reference.parentSessionId as SessionId
  ctx.uiWorkspace.openSession(id)
  await ctx.sessions.using(id, { source: 'sidecarView' }, async ref => {
    const binding = await ref.ready
    await binding.session.loadThrough(reference.sourceSeq as SessionSeq)
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const observer = new MutationObserver(locate)
      function finish(error?: Error) { observer.disconnect(); clearTimeout(timer); error ? reject(error) : resolve() }
      function locate() {
        const markers = document.querySelectorAll<HTMLElement>('[data-sidecar-assistant-marker]')
        const marker = [...markers].find(e => e.dataset.sidecarMessageId === reference.sourceMessageId
          && e.dataset.sidecarSessionId === reference.parentSessionId && !e.closest('[data-sidecar-native-surface]'))
        if (!marker) return
        const rows = [...document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"]')]
          .filter(e => !e.closest('[data-sidecar-native-surface]'))
        const row = rows.filter(e => e.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1)
          ?? marker.closest<HTMLElement>('[data-chat-flow-key]') ?? marker
        row.scrollIntoView({ block: 'center', behavior: 'instant' })
        row.animate([{ backgroundColor: 'rgba(114,159,255,.45)' }, { backgroundColor: 'transparent' }], { duration: 3000 })
        if (reference.sourceKind === 'selection') {
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
          const nodes: Text[] = []; let node: Node | null
          while ((node = walker.nextNode())) nodes.push(node as Text)
          const text = nodes.map(n => n.data).join('')
          let start = reference.textOffset !== undefined && text.slice(reference.textOffset, reference.textOffset + reference.quote.length) === reference.quote ? reference.textOffset : text.indexOf(reference.quote)
          let end = start + reference.quote.length
          if (start < 0) {
            // Browser selection inserts layout whitespace between Markdown blocks;
            // text nodes do not. Keep a character map back to the original DOM.
            const positions: number[] = []
            let compact = ''
            for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i]!)) { positions.push(i); compact += text[i] }
            const needle = reference.quote.replace(/\s/g, '')
            const found = needle ? compact.indexOf(needle) : -1
            if (found >= 0) { start = positions[found]!; end = positions[found + needle.length - 1]! + 1 }
          }
          if (start >= 0) {
            const range = document.createRange(); let offset = 0; let began = false
            for (const n of nodes) {
              if (!began && offset + n.length > start) { range.setStart(n, start - offset); began = true }
              if (began && offset + n.length >= end) { range.setEnd(n, end - offset); break }
              offset += n.length
            }
            window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
          }
        }
        finish()
      }
      observer.observe(document.body, { childList: true, subtree: true })
      timer = setTimeout(() => finish(new Error('来源消息未显示，请重试或检查来源会话是否已删除')), 10000)
      locate()
    })
  })
}

/** Native history paging loads the requested turn; only its rendered main-chat anchor is highlighted. */
export async function revealTurn(ctx: Context, parent: string, turn: { turn: number; seq: number }): Promise<void> {
  const id = parent as SessionId
  ctx.uiWorkspace.openSession(id)
  await ctx.sessions.using(id, { source: 'sidecarView' }, async ref => {
    const binding = await ref.ready
    await binding.session.loadThrough(turn.seq as SessionSeq)
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const observer = new MutationObserver(locate)
      function finish(error?: Error) { observer.disconnect(); clearTimeout(timer); error ? reject(error) : resolve() }
      function locate() {
        if (ctx.uiSession.adapter.current.getSnapshot().key !== parent) return
        const rows = [...document.querySelectorAll<HTMLElement>('[data-chat-turn]')]
          .filter(row => row.dataset.chatTurn === String(turn.turn) && !row.closest('[data-sidecar-native-surface]') && row.getClientRects().length > 0)
        const row = rows.find(row => row.dataset.chatFlowKind === 'user') ?? rows[0]
        if (!row) return
        window.getSelection()?.removeAllRanges()
        row.scrollIntoView({ block: 'center', behavior: 'instant' })
        row.dataset.sidecarTurnHighlight = String(turn.turn)
        row.animate([{ backgroundColor: 'rgba(233,165,43,.5)', boxShadow: 'inset 4px 0 #d49118' }, { backgroundColor: 'transparent', boxShadow: 'inset 0 0 transparent' }], { duration: 3000 })
        setTimeout(() => { delete row.dataset.sidecarTurnHighlight }, 3000)
        finish()
      }
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-turn'] })
      timer = setTimeout(() => finish(new Error('来源回合未显示，请重试或检查来源会话是否已删除')), 10000)
      locate()
    })
  })
}

export function registerReferences(ctx: Context, controller: SidecarController): () => void {
  const navigate = (r: SidecarReference) => revealReference(ctx, r)
  controller.referenceNavigator = navigate
  controller.turnNavigator = (parent, turn) => revealTurn(ctx, parent, turn)
  const triggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  const dispose = triggers.registerSource({
    name: SOURCE, trigger: '@', candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: ref => referenceLabel(parseReference(JSON.parse(ref))),
      serialize: ref => controller.api.serializeReference(parseReference(JSON.parse(ref))),
    },
    openReference: (_session, ref) => { controller.jumpToSource(parseReference(JSON.parse(ref.ref))); return true },
  })
  const rule = ctx.uiConversation.userText.register(referenceRule)
  function Citation({ node, interactive }: UserTextNodeProps<'sidecar-reference'>) {
    return <ReferenceChip appearance="session" label={referenceLabel(node.data)}
      title={node.data.quote || '回到来源回合'}
      {...interactive ? { onActivate: () => controller.jumpToSource(node.data) } : {}} />
  }
  const slot = ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node', key: SOURCE,
  }, Citation))
  return () => { dispose(); rule(); slot(); controller.referenceNavigator = undefined; controller.turnNavigator = undefined }
}

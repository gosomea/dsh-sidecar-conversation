import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button, DisclosureRow, IconCloseOutline16, IconCodeOutline16, IconSendOutline16, IconStopFill16, IconThinkOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { eventRpcId, transcriptFromEvents } from '../../core/transcript.js'
import type { SidecarAccessMode, SidecarRecord, TranscriptItem } from '../../core/types.js'
import { useConversationGeometry } from '../layout.js'
import { assistantSelectionRow } from '../selection.js'
import { useSidecarEvents } from '../transcript.js'
import type { SidecarController } from '../controller.js'
import { MarkdownText } from './MarkdownText.js'
import css from './SidecarDrawer.module.css'

interface Injected { controller: SidecarController }
type Props = PropsRuntime<'shell.overlay'> & InjectFace<Injected>

function requestKey(...parts: string[]): string { return parts.join(':') }

function PendingCard({ wait }: { wait: PendingInteraction }) {
  const [busy, setBusy] = useState(false)
  if (wait.kind === 'approval') {
    const respond = async (outcome: 'allowed-once' | 'rejected'): Promise<void> => {
      setBusy(true)
      try { await wait.respond({ ok: true, value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome } }) }
      finally { setBusy(false) }
    }
    return <section className={css.interaction}>
      <strong>等待审批</strong><p>{wait.payload.reason ?? wait.payload.toolName}</p>
      <div className={css.row}><Button size="sm" disabled={busy} onClick={() => { void respond('rejected') }}>拒绝</Button><Button size="sm" variant="primary" disabled={busy} onClick={() => { void respond('allowed-once') }}>允许一次</Button></div>
    </section>
  }
  return <QuestionCard wait={wait} />
}

function QuestionCard({ wait }: { wait: Extract<PendingInteraction, { kind: 'question' }> }) {
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; custom: string }>>({})
  const [busy, setBusy] = useState(false)
  const updateOption = (id: string, label: string, multiple: boolean): void => setAnswers(current => {
    const answer = current[id] ?? { selected: [], custom: '' }
    const selected = multiple
      ? answer.selected.includes(label) ? answer.selected.filter(item => item !== label) : [...answer.selected, label]
      : [label]
    return { ...current, [id]: { ...answer, selected } }
  })
  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await wait.respond({ ok: true, value: { sessionId: wait.sessionId, answer: { answers: wait.payload.questions.map(question => ({
        id: question.id, selected: answers[question.id]?.selected ?? [],
        ...(answers[question.id]?.custom.trim() ? { custom: answers[question.id]?.custom.trim() } : {}),
      })) } } })
    } finally { setBusy(false) }
  }
  return <section className={css.interaction}>
    <strong>等待回答</strong>
    {wait.payload.questions.map(question => {
      const answer = answers[question.id] ?? { selected: [], custom: '' }
      return <fieldset className={css.fieldset} key={question.id}>
        <legend>{question.header ?? question.question}</legend>
        {question.header !== undefined && <p className={css.secondary}>{question.question}</p>}
        {question.options?.map(option => <label className={css.option} key={option.label}>
          <input type={question.multiSelect ? 'checkbox' : 'radio'} name={question.id} checked={answer.selected.includes(option.label)} onChange={() => { updateOption(question.id, option.label, question.multiSelect === true) }} />
          <span>{option.label}{option.description === undefined ? null : <small> — {option.description}</small>}</span>
        </label>)}
        <input className={css.textInput} value={answer.custom} placeholder="其他回答（可选）" onChange={event => { setAnswers(current => ({ ...current, [question.id]: { ...answer, custom: event.target.value } })) }} />
      </fieldset>
    })}
    <Button size="sm" variant="primary" disabled={busy} onClick={() => { void submit() }}>{busy ? '提交中…' : '提交回答'}</Button>
  </section>
}

function SourcePill({ kind, quote, onRemove }: { kind: 'selection' | 'turn'; quote: string; onRemove?: () => void }) {
  return <details className={css.sourcePill}>
    <summary><span>{kind === 'turn' ? '整个回合' : '1 个已选文本片段'}</span>{onRemove !== undefined && <button type="button" aria-label="移除选中文本" onPointerDown={event => { event.preventDefault(); event.stopPropagation() }} onClick={event => { event.preventDefault(); event.stopPropagation(); onRemove() }}><IconCloseOutline16 size={14} /></button>}</summary>
    <div>{kind === 'turn' ? '子会话将从该回合的最终 Assistant 消息分叉，自动继承整个回合的上下文。' : quote}</div>
  </details>
}

function accessLabel(mode: SidecarAccessMode): string { return mode === 'read-only' ? '只读' : '继承' }

function AccessModeSelector({ value, onChange }: { value: SidecarAccessMode; onChange: (mode: SidecarAccessMode) => void }) {
  return <div className={css.accessSelector} role="radiogroup" aria-label="侧边对话访问模式">
    <button type="button" role="radio" aria-checked={value === 'read-only'} className={value === 'read-only' ? css.accessSelected : ''} onClick={() => { onChange('read-only') }}>
      <strong>只读</strong><span>可分析和搜索，不能修改工作区</span>
    </button>
    <button type="button" role="radio" aria-checked={value === 'inherit'} className={value === 'inherit' ? css.accessSelected : ''} onClick={() => { onChange('inherit') }}>
      <strong>继承</strong><span>沿用分叉点的权限，可执行修改</span>
    </button>
  </div>
}

function Composer({ value, onChange, onSend, sending, running, onStop, source, accessMode }: {
  value: string; onChange: (value: string) => void; onSend: () => void; sending: boolean; running?: boolean; onStop?: () => void
  source?: { kind: 'selection' | 'turn'; quote: string; onRemove?: () => void }
  accessMode: SidecarAccessMode
}) {
  const composing = useRef(false)
  return <div className={css.composerWrap}>
    <div className={css.composer}>
      {source !== undefined && <SourcePill {...source} />}
      <textarea autoFocus={source !== undefined} value={value} onChange={event => { onChange(event.target.value) }} placeholder="继续在侧边提问…" rows={3}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => { composing.current = false }}
        onKeyDown={event => {
          const native = event.nativeEvent
          const inComposition = composing.current || native.isComposing || native.keyCode === 229
          if (event.key === 'Enter' && !event.shiftKey && !inComposition) { event.preventDefault(); onSend() }
        }} />
      <div className={css.composerFooter}>
        <span>{accessMode === 'read-only' ? '只读工作区 · 禁止提权' : '共享工作区 · 权限继承自分叉点'}</span>
        {running
          ? <Button className={css.iconButton} aria-label="停止生成" size="sm" variant="toolbar" onClick={onStop}><IconStopFill16 size={15} /></Button>
          : <Button className={css.iconButton} aria-label="发送" size="sm" variant="primary" disabled={sending || !value.trim()} onClick={onSend}><IconSendOutline16 size={16} /></Button>}
      </div>
    </div>
  </div>
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0]
  return line === undefined ? '' : line
}

function TranscriptDisclosure({ item }: { item: TranscriptItem }) {
  const [open, setOpen] = useState(false)
  const reasoning = item.kind === 'reasoning'
  const lines = item.text.split('\n')
  const toolName = firstLine(item.text) || '工具调用'
  const body = reasoning ? item.text : lines.slice(1).join('\n') || item.text
  const summary = reasoning ? firstLine(item.text) : firstLine(body)
  return <div className={css.disclosure} data-kind={item.kind}>
    <DisclosureRow
      icon={reasoning ? <IconThinkOutline14 size={14} /> : <IconCodeOutline16 size={14} />}
      title={reasoning ? 'Think' : toolName}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={summary ? <><span className={css.disclosureSeparator} aria-hidden /><span className={css.disclosureSummary}>{summary}</span></> : undefined}
    >
      <pre className={css.disclosureBody}>{body}</pre>
    </DisclosureRow>
  </div>
}

function SidecarTranscript({ controller, record }: { controller: SidecarController; record: SidecarRecord }) {
  const { events, error } = useSidecarEvents(controller.api, controller.connection, record.childSessionId)
  const items = useMemo(() => transcriptFromEvents(events, record.firstPromptRpcId), [events, record.firstPromptRpcId])
  const clientSnapshot = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot)
  const optimistic = clientSnapshot.optimisticByChild[record.childSessionId] ?? []
  const deliveredRpcIds = useMemo(() => new Set(events.map(eventRpcId).filter((id): id is string => id !== undefined)), [events])
  const deliveredSignature = [...deliveredRpcIds].join('\u0000')
  const optimisticRpcSignature = optimistic.map(item => item.rpcId ?? '').join('\u0000')
  useEffect(() => { controller.store.resolveOptimistic(record.childSessionId, deliveredRpcIds) },
    [controller, record.childSessionId, deliveredSignature, optimisticRpcSignature])
  const face = controller.face(record.childSessionId)
  const runtime = useSyncExternalStore(
    listener => face?.subscribe(listener) ?? (() => undefined),
    () => face?.getSnapshot(),
    () => undefined,
  )
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string>()
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [items.length, optimistic.length, runtime?.running])
  const send = async (): Promise<void> => {
    const question = text.trim(); if (!question || sending) return
    setSending(true); setSendError(undefined); setText('')
    try { await controller.prompt({ childSessionId: record.childSessionId, requestKey: requestKey(record.childSessionId, String(Date.now()), question), question }) }
    catch (reason: unknown) { setSendError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSending(false) }
  }
  return <div className={css.body}>
    <div className={css.transcript}>
      <div className={css.transcriptColumn}>
        <SourcePill kind={record.sourceKind ?? 'selection'} quote={record.quote} />
        {items.map(item => item.collapsed
          ? <TranscriptDisclosure key={item.key} item={item} />
          : item.kind === 'user'
            ? <div key={item.key} className={css.userGroup}>
              {item.sourceKind !== undefined && item.rpcId !== record.firstPromptRpcId && <SourcePill kind={item.sourceKind} quote={item.quote ?? ''} />}
              <div className={`${css.message} ${css.user}`}><span className={css.userText}>{item.text}</span></div>
            </div>
            : <div key={item.key} className={`${css.message} ${css[item.kind]}`}><MarkdownText text={item.text} /></div>)}
        {optimistic.map(item => <div className={css.userGroup} key={`optimistic:${item.requestKey}`}>
          {item.source !== undefined && <SourcePill kind={item.source.sourceKind} quote={item.source.quote} />}
          <div className={`${css.message} ${css.user}`}><span className={css.userText}>{item.question}</span></div>
          <span className={`${css.optimisticStatus} ${item.state === 'failed' ? css.optimisticFailed : ''}`}>{item.state === 'failed' ? `发送失败：${item.error ?? '未知错误'}` : '发送中…'}</span>
        </div>)}
        {runtime?.running && <div className={css.running}>正在生成…</div>}
        {runtime?.pending.map(wait => <PendingCard key={wait.key} wait={wait} />)}
        {(error ?? sendError) !== undefined && <div role="status" className={css.error}>{error ?? sendError}</div>}
        <div ref={end} />
      </div>
    </div>
    <Composer value={text} onChange={setText} onSend={() => { void send() }} sending={sending} running={runtime?.running === true} onStop={() => { void face?.cancel() }} accessMode={record.access.mode} />
  </div>
}

function Draft({ controller, parentSessionId }: { controller: SidecarController; parentSessionId: string }) {
  const snapshot = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot)
  const draft = snapshot.ui.byParent[parentSessionId]?.draft
  const [sending, setSending] = useState(false)
  const [submittedQuestion, setSubmittedQuestion] = useState('')
  if (draft === undefined) return null
  const records = snapshot.recordsByParent[parentSessionId] ?? []
  const parent = snapshot.ui.byParent[parentSessionId]
  const active = records.find(item => item.childSessionId === parent?.activeChildSessionId) ?? records[0]
  const reuse = active !== undefined && draft.forceNew !== true
  const submit = async (): Promise<void> => {
    if (!draft.question.trim() || sending) return
    const question = draft.question.trim()
    setSending(true)
    try {
      if (reuse) {
        const prompt = controller.prompt({
          childSessionId: active.childSessionId,
          requestKey: requestKey(active.childSessionId, String(Date.now()), draft.sourceKind, draft.sourceMessageId, String(draft.sourceSeq), draft.quote, question),
          question,
          source: { sourceMessageId: draft.sourceMessageId, sourceSeq: draft.sourceSeq, sourceKind: draft.sourceKind, quote: draft.quote },
        })
        controller.store.clearDraft(parentSessionId)
        controller.store.select(parentSessionId, active.childSessionId)
        await prompt
      } else {
        setSubmittedQuestion(question)
        controller.store.updateDraftQuestion(parentSessionId, '')
        await controller.create({
          parentSessionId, sourceKind: draft.sourceKind,
          requestKey: requestKey(parentSessionId, draft.accessMode, draft.sourceKind, draft.sourceMessageId, String(draft.sourceSeq), draft.quote, question),
          sourceMessageId: draft.sourceMessageId, sourceSeq: draft.sourceSeq, quote: draft.quote, question,
          accessMode: draft.accessMode,
        })
      }
    } catch (error: unknown) {
      if (!reuse) controller.store.updateDraftQuestion(parentSessionId, question)
      controller.store.setError(error)
    } finally { setSending(false); setSubmittedQuestion('') }
  }
  return <div className={css.body}>
    <div className={css.draftHero}>
      <h3>{draft.sourceKind === 'turn' ? '从这个回合继续' : '针对选中内容提问'}</h3>
      <p>{reuse ? '发送到当前侧边对话，避免产生零散分支。' : '首次发送时创建独立子 Session，主对话保持不变。'}</p>
      {reuse
        ? <div className={css.inheritedMode}>将使用当前侧问的「{accessLabel(active.access.mode)}」模式</div>
        : <AccessModeSelector value={draft.accessMode} onChange={mode => { controller.store.setDraftAccessMode(parentSessionId, mode) }} />}
      {active !== undefined && <Button size="sm" variant="ghost" onClick={() => { controller.store.setDraftForceNew(parentSessionId, reuse) }}>
        {reuse ? '新建独立侧问' : '继续当前侧问'}
      </Button>}
      {submittedQuestion && <div className={css.draftSubmitted}><div className={`${css.message} ${css.user}`}><span className={css.userText}>{submittedQuestion}</span></div><span>正在创建侧边对话…</span></div>}
    </div>
    <Composer value={draft.question} onChange={value => { controller.store.updateDraftQuestion(parentSessionId, value) }} onSend={() => { void submit() }} sending={sending}
      accessMode={reuse ? active.access.mode : draft.accessMode}
      source={{ kind: draft.sourceKind, quote: draft.quote, ...(draft.sourceKind === 'selection' ? { onRemove: () => { controller.store.useWholeTurnDraft(parentSessionId) } } : {}) }} />
  </div>
}

function SelectionMenu({ parentSessionId, controller }: { parentSessionId: string; controller: SidecarController }) {
  const [menu, setMenu] = useState<{ quote: string; left: number; top: number; messageId: string; sourceSeq: number }>()
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let captureFrame = 0
    const clear = (): void => { setMenu(undefined) }
    const clearOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') clear() }
    const capture = (): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
      const sourceRow = assistantSelectionRow(selection)
      if (sourceRow === undefined) return
      const quote = selection.toString().trim()
      if (!quote || quote.length > 4_000) return
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      const candidate = controller.selectedAssistant(parentSessionId, quote, sourceRow)
      if (candidate === undefined) return
      setMenu({ quote, messageId: candidate.messageId, sourceSeq: candidate.sourceSeq,
        left: Math.min(window.innerWidth - 250, Math.max(12, rect.left + rect.width / 2 - 108)),
        top: Math.max(12, rect.top - 42) })
    }
    const scheduleCapture = (event?: PointerEvent): void => {
      if (event !== undefined && (event.button !== 0 || !event.isPrimary)) return
      window.cancelAnimationFrame(captureFrame)
      captureFrame = window.requestAnimationFrame(capture)
    }
    const pointerStarted = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node) === true) return
      clear()
    }
    document.addEventListener('pointerdown', pointerStarted)
    document.addEventListener('pointerup', scheduleCapture)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('keydown', clearOnEscape)
    return () => {
      window.cancelAnimationFrame(captureFrame)
      document.removeEventListener('pointerdown', pointerStarted)
      document.removeEventListener('pointerup', scheduleCapture)
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('keydown', clearOnEscape)
    }
  }, [controller, parentSessionId])
  if (menu === undefined) return null
  return <div ref={menuRef} data-sidecar-selection-menu="" className={css.selectionMenu} style={{ left: menu.left, top: menu.top }}>
    <Button size="sm" variant="ghost" onPointerDown={event => { event.preventDefault(); event.stopPropagation() }} onClick={() => {
      controller.store.openDraft(parentSessionId, { sourceKind: 'selection', sourceMessageId: menu.messageId, sourceSeq: menu.sourceSeq, quote: menu.quote, question: '', accessMode: 'read-only' })
      window.getSelection()?.removeAllRanges(); setMenu(undefined)
    }}>在侧边聊天中提问</Button>
  </div>
}

export function SidecarDrawer({ useSessions, controller }: Props) {
  const current = useSessions(state => state.current)
  const snapshot = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot)
  const parentId = String(current ?? '')
  const parent = controller.store.parent(parentId)
  const records = snapshot.recordsByParent[parentId] ?? []
  const hasContent = records.length > 0 || parent.draft !== undefined
  const visible = current !== undefined && hasContent && parent.open
  const geometry = useConversationGeometry(parent.width, visible)
  useEffect(() => { if (current !== undefined) void controller.load(String(current)) }, [controller, current])
  if (current === undefined) return null
  const active = records.find(item => item.childSessionId === parent.activeChildSessionId) ?? records[0]
  return <>
    <SelectionMenu parentSessionId={parentId} controller={controller} />
    {visible && geometry !== undefined && <aside data-sidecar-conversation="" className={`${css.root} ${geometry.full ? css.full : ''}`} style={{ top: geometry.top, left: geometry.left, width: geometry.width, height: geometry.height }}>
      {!geometry.full && <div className={css.resize} role="separator" aria-orientation="vertical" onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const startX = event.clientX; const startWidth = parent.width
        const move = (next: PointerEvent): void => { controller.store.resize(parentId, startWidth + startX - next.clientX) }
        const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
      }}><span /></div>}
      <header className={css.header}>
        <div className={css.heading}><strong>侧边聊天</strong><span>{records.length > 0 ? `${records.length} 个对话` : '新建提问'}</span></div>
        <div className={css.headerActions}>
          <Button className={css.headerButton} size="sm" variant="ghost" aria-label="关闭侧边聊天" onClick={() => { controller.store.close(parentId) }}><IconCloseOutline16 size={16} /></Button>
        </div>
      </header>
      {records.length > 0 && <nav className={css.tabs} aria-label="Sidecar 对话">
        {records.map(record => <button className={active?.childSessionId === record.childSessionId && parent.draft === undefined ? css.activeTab : ''} key={record.childSessionId} type="button" title={`${accessLabel(record.access.mode)} · ${record.title}`} onClick={() => { controller.store.select(parentId, record.childSessionId) }}><span className={css.tabMode}>{accessLabel(record.access.mode)}</span>{record.title.replace(/^↳ 侧问 · /, '')}</button>)}
      </nav>}
      {snapshot.error !== undefined && <div role="alert" className={css.errorBanner}>{snapshot.error}</div>}
      {parent.draft !== undefined ? <Draft controller={controller} parentSessionId={parentId} /> : active !== undefined ? <SidecarTranscript key={active.childSessionId} controller={controller} record={active} /> : null}
    </aside>}
  </>
}

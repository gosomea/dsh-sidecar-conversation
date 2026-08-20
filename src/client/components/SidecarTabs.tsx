import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconCloseOutline16, IconSendOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidecarAccessMode, SidecarDraft, SidecarRecord } from '../../core/types.js'
import type { SidecarController } from '../controller.js'
import {
  sidecarMetaFromTab,
  type BetterSidebarTabComponentProps,
} from '../better-sidebar.js'
import css from './SidecarTabs.module.css'

const ACTIVE_SIDECAR_WARNING = 20

interface SidecarTabProps extends BetterSidebarTabComponentProps {
  controller: SidecarController
}

function promptRequestKey(): string {
  return `sidecar-prompt-${globalThis.crypto.randomUUID()}`
}

function accessLabel(mode: SidecarAccessMode): string {
  return mode === 'read-only' ? '只读' : '继承'
}

function displayTitle(record: SidecarRecord): string {
  return record.title.replace(/^↳\s*侧问\s*·\s*/, '')
}

function SourcePill({ kind, quote, onRemove }: {
  kind: 'selection' | 'turn'
  quote: string
  onRemove?: () => void
}) {
  return <details className={css.sourcePill}>
    <summary>
      <span>{kind === 'turn' ? '整个回合' : '1 个已选文本片段'}</span>
      {onRemove !== undefined && <button
        type="button"
        aria-label="移除选中文本"
        onPointerDown={event => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          onRemove()
        }}
      ><IconCloseOutline16 size={14} /></button>}
    </summary>
    <div>{kind === 'turn'
      ? '子会话从该回合的最终 Assistant 消息分叉，并继承此前上下文。'
      : quote}</div>
  </details>
}

function AccessModeSelector({ value, onChange }: {
  value: SidecarAccessMode
  onChange: (mode: SidecarAccessMode) => void
}) {
  return <div className={css.accessSelector} role="radiogroup" aria-label="侧边对话访问模式">
    <button
      type="button"
      role="radio"
      aria-checked={value === 'read-only'}
      className={value === 'read-only' ? css.accessSelected : ''}
      onClick={() => { onChange('read-only') }}
    >
      <strong>只读</strong>
      <span>可分析和搜索，不能修改工作区</span>
    </button>
    <button
      type="button"
      role="radio"
      aria-checked={value === 'inherit'}
      className={value === 'inherit' ? css.accessSelected : ''}
      onClick={() => { onChange('inherit') }}
    >
      <strong>继承</strong>
      <span>沿用分叉点的权限，可执行修改</span>
    </button>
  </div>
}

function DraftComposer({ draft, sending, visible, onChange, onSend }: {
  draft: SidecarDraft & { requestKey: string }
  sending: boolean
  visible: boolean
  onChange: (next: SidecarDraft & { requestKey: string }) => void
  onSend: () => void
}) {
  const composing = useRef(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!visible) return
    const frame = window.requestAnimationFrame(() => { textarea.current?.focus() })
    return () => { window.cancelAnimationFrame(frame) }
  }, [visible])
  return <div className={css.composerWrap}>
    <div className={css.composer}>
      <SourcePill
        kind={draft.sourceKind}
        quote={draft.quote}
        {...(draft.sourceKind === 'selection'
          ? { onRemove: () => { onChange({ ...draft, sourceKind: 'turn', quote: '' }) } }
          : {})}
      />
      <textarea
        ref={textarea}
        autoFocus={visible}
        rows={4}
        value={draft.question}
        placeholder="在侧边栏提问…"
        readOnly={sending}
        onChange={event => { onChange({ ...draft, question: event.target.value }) }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => { composing.current = false }}
        onKeyDown={event => {
          const native = event.nativeEvent
          const inComposition = composing.current || native.isComposing || native.keyCode === 229
          if (event.key === 'Enter' && !event.shiftKey && !inComposition) {
            event.preventDefault()
            onSend()
          }
        }}
      />
      <div className={css.composerFooter}>
        <span>{draft.accessMode === 'read-only'
          ? '只读工作区 · 禁止提权'
          : '共享工作区 · 权限继承自分叉点'}</span>
        <Button
          className={css.sendButton}
          aria-label="发送"
          size="sm"
          variant="primary"
          disabled={sending || !draft.question.trim()}
          onClick={onSend}
        ><IconSendOutline16 size={16} /></Button>
      </div>
    </div>
  </div>
}

function DraftSidecar({ controller, parentSessionId, requestKey, initialDraft, visible }: {
  controller: SidecarController
  parentSessionId: string
  requestKey: string
  initialDraft: SidecarDraft & { requestKey: string }
  visible: boolean
}) {
  const [draft, setDraft] = useState(initialDraft)
  const [sending, setSending] = useState(false)
  const [submittedQuestion, setSubmittedQuestion] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => { setDraft(initialDraft) }, [initialDraft])

  const change = (next: SidecarDraft & { requestKey: string }): void => {
    setDraft(next)
    controller.updateDraft(parentSessionId, requestKey, next)
  }
  const submit = async (): Promise<void> => {
    const question = draft.question.trim()
    if (!question || sending) return
    setSending(true)
    setSubmittedQuestion(question)
    setError(undefined)
    try {
      const record = await controller.create({
        parentSessionId,
        requestKey,
        sourceKind: draft.sourceKind,
        sourceMessageId: draft.sourceMessageId,
        sourceSeq: draft.sourceSeq,
        quote: draft.quote,
        question,
        accessMode: draft.accessMode,
      })
      controller.store.addOptimistic({
        childSessionId: record.childSessionId,
        requestKey: `first:${record.requestKey}`,
        question: record.firstQuestion,
      })
      controller.store.ackOptimistic(
        record.childSessionId,
        `first:${record.requestKey}`,
        record.firstPromptRpcId,
      )
      controller.activateTab(record)
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      controller.store.setError(reason)
    } finally {
      setSending(false)
      setSubmittedQuestion(undefined)
    }
  }

  return <div className={css.tabRoot}>
    <div className={css.draftBody}>
      <div className={css.draftHero}>
        <h3>{draft.sourceKind === 'turn' ? '从这个回合继续' : '针对选中内容提问'}</h3>
        <p>首次发送时创建独立子 Session，主对话保持不变。</p>
        <AccessModeSelector value={draft.accessMode} onChange={mode => { change({ ...draft, accessMode: mode }) }} />
        {submittedQuestion !== undefined && <div className={css.submitted}>
          <span>{submittedQuestion}</span>
          <small>正在创建侧边对话…</small>
        </div>}
        {error !== undefined && <div role="alert" className={css.error}>{error}</div>}
      </div>
    </div>
    <DraftComposer draft={draft} sending={sending} visible={visible} onChange={change} onSend={() => { void submit() }} />
  </div>
}

function ActiveSidecar({ controller, record, visible }: {
  controller: SidecarController
  record: SidecarRecord
  visible: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [mountError, setMountError] = useState<string>()

  useEffect(() => {
    const container = host.current
    if (!visible || container === null || record.status === 'archived') return
    let live = true
    let dispose: (() => void) | undefined
    setMountError(undefined)
    void controller.mountNativeSurface(record, container).then(unmount => {
      if (live) dispose = unmount
      else unmount()
    }).catch((reason: unknown) => {
      if (live) setMountError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      live = false
      dispose?.()
    }
  }, [controller, record, visible])

  if (record.status === 'archived') {
    return <div className={css.centerState}>
      <h3>这个侧问已归档</h3>
      <p>恢复后会继续使用原来的子 Session，不会创建新会话。</p>
      <Button variant="primary" onClick={() => { void controller.archive(record.parentSessionId, record.childSessionId, false) }}>恢复侧问</Button>
    </div>
  }

  return <div className={css.tabRoot}>
    <div className={css.contextBar}>
      <SourcePill kind={record.sourceKind ?? 'selection'} quote={record.quote} />
      <span>{accessLabel(record.access.mode)}</span>
      <button type="button" onClick={() => { void controller.archive(record.parentSessionId, record.childSessionId, true) }}>归档</button>
    </div>
    <div ref={host} className={css.nativeSurfaceHost} data-sidecar-native-surface="" />
    {mountError !== undefined && <div role="alert" className={css.surfaceError}>{mountError}</div>}
  </div>
}

export function SidecarChatTab({ controller, scope, tab, visible }: SidecarTabProps) {
  const snapshot = useSyncExternalStore(
    controller.store.subscribe,
    controller.store.getSnapshot,
    controller.store.getSnapshot,
  )
  const meta = sidecarMetaFromTab(tab)
  const parentSessionId = meta?.parentSessionId
  useEffect(() => {
    if (parentSessionId !== undefined && scope.sessionId === parentSessionId) void controller.load(parentSessionId)
  }, [controller, parentSessionId, scope.sessionId])

  const records = parentSessionId === undefined
    ? []
    : snapshot.recordsByParent[parentSessionId] ?? []
  const record = meta === undefined
    ? undefined
    : records.find(item => item.requestKey === meta.requestKey)
  useEffect(() => {
    if (meta?.kind === 'draft' && record !== undefined) controller.activateTab(record)
  }, [controller, meta?.kind, record])

  if (meta === undefined) return <InvalidTab message="这个侧问 Tab 的状态无效，请从侧问历史重新打开。" />
  if (scope.sessionId !== meta.parentSessionId) {
    return <InvalidTab message="这个侧问属于另一个主会话，已阻止跨会话显示。" />
  }

  if (meta.kind === 'draft' && record === undefined) {
    return <DraftSidecar
      controller={controller}
      parentSessionId={meta.parentSessionId}
      requestKey={meta.requestKey}
      initialDraft={meta.draft}
      visible={visible}
    />
  }
  if (record !== undefined) {
    return <ActiveSidecar controller={controller} record={record} visible={visible} />
  }
  if (snapshot.loadingParents[meta.parentSessionId]) return <LoadingState />
  if (snapshot.error !== undefined) {
    return <LoadErrorState
      message={snapshot.error}
      onRetry={() => { void controller.load(meta.parentSessionId) }}
    />
  }
  return <InvalidTab message="未找到这个侧问的持久化记录，请从侧问历史重新打开。" />
}

export function SidecarHistoryTab({ controller, scope }: SidecarTabProps) {
  const snapshot = useSyncExternalStore(
    controller.store.subscribe,
    controller.store.getSnapshot,
    controller.store.getSnapshot,
  )
  const records = snapshot.recordsByParent[scope.sessionId] ?? []
  const [busy, setBusy] = useState<string>()
  useEffect(() => { void controller.load(scope.sessionId) }, [controller, scope.sessionId])

  const changeArchive = async (record: SidecarRecord, archived: boolean): Promise<void> => {
    if (busy !== undefined) return
    setBusy(record.childSessionId)
    try { await controller.archive(record.parentSessionId, record.childSessionId, archived) }
    catch (reason: unknown) { controller.store.setError(reason) }
    finally { setBusy(undefined) }
  }

  if (snapshot.loadingParents[scope.sessionId] && records.length === 0) return <LoadingState />
  if (snapshot.error !== undefined && records.length === 0) {
    return <LoadErrorState
      message={snapshot.error}
      onRetry={() => { void controller.load(scope.sessionId) }}
    />
  }
  if (records.length === 0) return <div className={css.centerState}>
    <h3>还没有侧问</h3>
    <p>在 Assistant 回答中选择文字，或使用回合操作里的“侧问”。</p>
  </div>

  const activeCount = records.filter(item => item.status !== 'archived').length
  return <div className={css.historyRoot}>
    <header>
      <h3>侧问历史</h3>
      <span>{records.length} 个对话</span>
    </header>
    {activeCount > ACTIVE_SIDECAR_WARNING && <div className={css.warning}>
      当前主会话已有 {activeCount} 个活动侧问，建议归档不再使用的对话。
    </div>}
    <div className={css.historyList}>
      {records.map(record => <article key={record.childSessionId} className={css.historyItem}>
        <button type="button" className={css.historyMain} onClick={() => { controller.openRecord(record) }}>
          <strong>{displayTitle(record)}</strong>
          <span>{accessLabel(record.access.mode)} · {record.status === 'archived' ? '已归档' : '活动'}</span>
          {record.quote && <small>{record.quote.replace(/\s+/g, ' ').slice(0, 100)}</small>}
        </button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== undefined}
          onClick={() => { void changeArchive(record, record.status !== 'archived') }}
        >{busy === record.childSessionId ? '处理中…' : record.status === 'archived' ? '恢复' : '归档'}</Button>
      </article>)}
    </div>
    {snapshot.error !== undefined && <LoadErrorBanner
      message={snapshot.error}
      onRetry={() => { void controller.load(scope.sessionId) }}
    />}
  </div>
}

function LoadingState() {
  return <div className={css.centerState}><p>正在加载侧问…</p></div>
}

function LoadErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className={css.centerState} role="alert">
    <h3>侧问加载失败</h3>
    <p>{message}</p>
    <Button variant="primary" onClick={onRetry}>重试</Button>
  </div>
}

function LoadErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className={css.loadErrorBanner} role="alert">
    <span>{message}</span>
    <Button size="sm" variant="ghost" onClick={onRetry}>重试</Button>
  </div>
}

function InvalidTab({ message }: { message: string }) {
  return <div className={css.centerState}><h3>无法打开侧问</h3><p>{message}</p></div>
}

/** Used by the native custom-submit adapter once the embedded Surface lands. */
export async function submitSidecarText(controller: SidecarController, childSessionId: string, text: string): Promise<void> {
  await controller.prompt({ childSessionId, requestKey: promptRequestKey(), question: text })
}

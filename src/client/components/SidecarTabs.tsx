import type { ReactNode } from 'react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidecarDraft, SidecarRecord } from '../../core/types.js'
import type { SidecarController } from '../controller.js'
import {
  sidecarMetaFromTab,
  type BetterSidebarTabComponentProps,
} from '../better-sidebar.js'
import css from './SidecarTabs.module.css'

const ACTIVE_SIDECAR_WARNING = 20

interface SidecarTabProps extends BetterSidebarTabComponentProps {
  controller: SidecarController
  renderConversation?: (record: SidecarRecord) => ReactNode
}

function displayTitle(record: SidecarRecord): string {
  return record.title.replace(/^↳\s*侧问\s*·\s*/, '')
}

function DraftSidecar({ controller, parentSessionId, requestKey, initialDraft, visible }: {
  controller: SidecarController; parentSessionId: string; requestKey: string
  initialDraft: SidecarDraft & { requestKey: string }; visible: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const begin = async (creationMode: 'fork' | 'independent') => {
    if (busy) return
    setBusy(true); setError(undefined)
    const draft = { ...initialDraft, creationMode }
    controller.updateDraft(parentSessionId, requestKey, draft)
    try { await controller.prepare(parentSessionId, requestKey, draft) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false) }
  }
  const started = useRef<string>()
  useEffect(() => {
    if (initialDraft.creationConfirmed && visible && started.current !== requestKey) {
      started.current = requestKey
      void begin(initialDraft.creationMode ?? 'fork')
    }
  }, [requestKey, initialDraft.creationConfirmed, visible])
  return <div className={css.centerState}>
    <h3>{busy ? '正在打开输入框…' : '新建侧问'}</h3>
    {!initialDraft.creationConfirmed && <div className={css.accessSelector}>
      <button type="button" disabled={busy} onClick={() => void begin('fork')}><strong>关联侧问</strong><span>从选中回合继续</span></button>
      <button type="button" disabled={busy} onClick={() => void begin('independent')}><strong>独立新会话</strong><span>只带入选文和问题</span></button>
    </div>}
    {initialDraft.creationConfirmed && error && <Button onClick={() => void begin(initialDraft.creationMode ?? 'fork')}>重试打开输入框</Button>}
    {initialDraft.question && <p>已保留草稿：{initialDraft.question}</p>}
    {error && <div role="alert" className={css.error}>{error}</div>}
  </div>
}

function ActiveSidecar({ controller, record, visible, renderConversation }: {
  controller: SidecarController
  record: SidecarRecord
  visible: boolean
  renderConversation?: ((record: SidecarRecord) => ReactNode) | undefined
}) {
  if (record.status === 'archived') {
    return <div className={css.centerState}>
      <h3>这个侧问已归档</h3>
      <p>恢复后会继续使用原来的子 Session，不会创建新会话。</p>
      <Button variant="primary" onClick={() => { void controller.archive(record.parentSessionId, record.childSessionId, false) }}>恢复侧问</Button>
    </div>
  }

  return <div className={css.tabRoot}>
    <div className={css.contextBar}>
      <span>{record.creationMode === 'independent' ? '独立新会话 · 不继承历史' : '关联侧问（Fork）· 继承上下文'}</span>
      <button type="button" title={record.quote || '回到来源回合'} onClick={() => controller.jumpToSource({ parentSessionId: record.parentSessionId, sourceMessageId: record.sourceMessageId, sourceSeq: record.sourceSeq, sourceKind: record.sourceKind ?? 'selection', quote: record.quote })}>来源回合 ↗</button>
      <button type="button" onClick={() => { void controller.archive(record.parentSessionId, record.childSessionId, true) }}>归档</button>
    </div>
    <div className={css.nativeSurfaceHost} data-sidecar-native-surface="">{visible && renderConversation?.(record)}</div>
  </div>
}

export function SidecarChatTab({ controller, scope, tab, visible, renderConversation }: SidecarTabProps) {
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
    return <ActiveSidecar controller={controller} record={record} visible={visible} renderConversation={renderConversation} />
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

  const createNew = async (): Promise<void> => {
    if (busy !== undefined) return
    setBusy('new')
    try { await controller.newFromHistory(scope.sessionId) }
    catch (reason: unknown) { controller.store.setError(reason) }
    finally { setBusy(undefined) }
  }
  const newButton = <Button size="sm" variant="ghost" disabled={busy !== undefined} onClick={() => { void createNew() }}>
    {busy === 'new' ? '正在准备…' : '新建侧问'}
  </Button>

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
    {newButton}
    <p>在 Assistant 回答中选择文字，或使用回合操作里的“侧问”。</p>
  </div>

  const activeCount = records.filter(item => item.status !== 'archived').length
  return <div className={css.historyRoot}>
    <header>
      <h3>侧问历史 <span>{records.length}</span></h3>
      {newButton}
    </header>
    {activeCount > ACTIVE_SIDECAR_WARNING && <div className={css.warning}>
      当前主会话已有 {activeCount} 个活动侧问，建议归档不再使用的对话。
    </div>}
    <div className={css.historyList}>
      {[...records].sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || b.updatedAt - a.updatedAt).map(record => <article key={record.childSessionId} className={css.historyItem} data-archived={record.status === 'archived'}>
        <button type="button" className={css.historyMain} onClick={() => { controller.openRecord(record) }}>
          <strong>{displayTitle(record)}</strong>
          <span>{record.creationMode === 'independent' ? '独立新会话' : 'Fork'}{record.status === 'archived' ? ' · 已归档' : ''}</span>
          <time dateTime={new Date(record.updatedAt).toISOString()}>{new Date(record.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
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

import type { TurnOutlineEntry } from '@deepseek-ai/dsh-session-turn-outline/types'
import type { SidecarController } from '../controller.js'
import css from './ForkContext.module.css'

/** Count native started turns after the immutable fork event, never referenced snippets. */
export function forkProgress(outline: readonly TurnOutlineEntry[] | undefined, sourceSeq: number) {
  if (!outline?.length) return undefined
  const source = outline.filter(t => t.seq <= sourceSeq).at(-1)
  if (!source) return undefined
  const newer = outline.filter(t => t.seq > sourceSeq)
  return { source, latest: outline.at(-1)!, firstNew: newer[0], count: newer.length }
}

export function ForkContext({ controller, parent, independent, progress, running, draft }: {
  controller: SidecarController; parent: string; independent?: boolean
  progress: ReturnType<typeof forkProgress>; running: boolean; draft?: boolean
}) {
  const jump = (turn: TurnOutlineEntry) => controller.jumpToTurn(parent, turn)
  return <aside className={css.context} aria-label="侧问上下文范围" data-sidecar-fork-context="" aria-live="polite">
    {independent ? <span title="独立会话不继承主会话历史，只带入明确添加的引用和问题">独立会话 · 仅带入引用</span>
      : !progress ? <span>正在读取上下文范围…</span> : <>
        <button type="button" title="查看分叉来源回合" onClick={() => jump(progress.source)}>{draft ? '将从' : 'Fork '}第 {progress.source.turn} 轮 ↗</button>
        <span aria-hidden="true">·</span>
        {progress.firstNew ? <button type="button" className={css.lag}
          title={`主会话新增 ${progress.count} 轮未自动带入；追加引用不会同步完整上下文。点击查看首个未继承回合：第 ${progress.firstNew.turn} 轮`}
          onClick={() => jump(progress.firstNew!)}>落后 {progress.count} 轮 ↗</button> : <span>暂无新增回合</span>}
        <span aria-hidden="true">·</span>
        <button type="button" title="查看主会话最新回合" onClick={() => jump(progress.latest)}>主会话第 {progress.latest.turn} 轮 ↗</button>
        {running && <span>进行中</span>}
      </>}
  </aside>
}

/* @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SidecarController } from '../src/client/controller.js'
import {
  SidecarChatTab,
  SidecarHistoryTab,
} from '../src/client/components/SidecarTabs.js'
import {
  activeSidecarTabMeta,
  draftSidecarTabMeta,
  SIDECAR_CHAT_TAB_TYPE,
} from '../src/client/tab-meta.js'
import type { BetterSidebarTabComponentProps } from '../src/client/better-sidebar.js'
import type { SidecarDraft, SidecarRecord } from '../src/core/types.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The production primitives import their CSS through the package's published
// source entry. Keep these component tests focused on tab behavior and avoid
// coupling the jsdom runner to the primitives' CSS loader.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: { children?: unknown; [key: string]: unknown }) =>
    createElement('button', props, props.children),
  ReferenceChip: ({ label, onActivate, title }: any) => createElement(onActivate ? 'button' : 'span', { onClick: onActivate, title }, label),
  IconCloseOutlineMedium: () => null,
  IconSendOutlineMedium: () => null,
}))

type Snapshot = {
  recordsByParent: Record<string, SidecarRecord[]>
  loadingParents: Record<string, boolean>
  optimisticByChild: Record<string, unknown[]>
  error?: string
}

interface FakeController {
  api: { serializeReference: ReturnType<typeof vi.fn> }
  store: {
    subscribe: (listener: () => void) => () => void
    getSnapshot: () => Snapshot
    addOptimistic: ReturnType<typeof vi.fn>
    ackOptimistic: ReturnType<typeof vi.fn>
    setError: ReturnType<typeof vi.fn>
  }
  prepare: ReturnType<typeof vi.fn>
  newFromHistory: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
  updateDraft: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  activateTab: ReturnType<typeof vi.fn>
  openRecord: ReturnType<typeof vi.fn>
  archive: ReturnType<typeof vi.fn>
}

const roots: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(async () => {
  await act(async () => {
    for (const entry of roots.splice(0)) entry.root.unmount()
  })
})

function makeSnapshot(recordsByParent: Record<string, SidecarRecord[]> = {}): Snapshot {
  return {
    recordsByParent,
    loadingParents: {},
    optimisticByChild: {},
  }
}

function makeController(snapshot: Snapshot = makeSnapshot()): FakeController {
  const subscribe = vi.fn((_listener: () => void) => () => undefined)
  const getSnapshot = vi.fn(() => snapshot)
  return {
    api: { serializeReference: vi.fn(async () => '') },
    store: {
      subscribe,
      getSnapshot,
      addOptimistic: vi.fn(),
      ackOptimistic: vi.fn(),
      setError: vi.fn(),
    },
    prepare: vi.fn(async () => undefined),
    newFromHistory: vi.fn(async () => undefined),
    load: vi.fn(async () => undefined),
    updateDraft: vi.fn(),
    create: vi.fn(),
    activateTab: vi.fn(),
    openRecord: vi.fn(),
    archive: vi.fn(async () => undefined),
  }
}

function asController(controller: FakeController): SidecarController {
  return controller as unknown as SidecarController
}

function draft(overrides: Partial<SidecarDraft> = {}): SidecarDraft & { requestKey: string } {
  return {
    requestKey: 'parent-1:selection:request-1',
    sourceKind: 'selection',
    sourceMessageId: 'message-1',
    sourceSeq: 42,
    quote: 'quoted text',
    question: '为什么？',
    accessMode: 'read-only',
    ...overrides,
  }
}

function record(overrides: Partial<SidecarRecord> = {}): SidecarRecord {
  return {
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    requestKey: 'parent-1:selection:request-1',
    sourceMessageId: 'message-1',
    sourceSeq: 42,
    sourceKind: 'selection',
    quote: 'quoted text',
    firstQuestion: '为什么？',
    firstPromptRpcId: 'rpc-1',
    access: { mode: 'read-only' },
    title: '↳ 侧问 · quoted text',
    createdAt: 1,
    updatedAt: 1,
    status: 'active',
    ...overrides,
  }
}

function chatProps(
  controller: FakeController,
  meta: unknown,
  options: Partial<Pick<BetterSidebarTabComponentProps, 'scope' | 'visible'>> = {},
): BetterSidebarTabComponentProps {
  return {
    ctx: {},
    store: {},
    scope: { sessionId: 'parent-1', ...(options.scope ?? {}) },
    tab: { id: 'sidecar:request-1', type: SIDECAR_CHAT_TAB_TYPE, title: '侧问', meta },
    visible: options.visible ?? true,
  }
}

async function render(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push({ root, container })
  await act(async () => { root.render(element) })
  return container
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(text) || candidate.getAttribute('aria-label') === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`)
  return button
}

describe('Sidecar Better Sidebar tabs', () => {
  it('strictly binds a chat tab to its parent scope', async () => {
    const controller = makeController()
    const meta = draftSidecarTabMeta('parent-1', 'parent-1:selection:request-1', draft())
    const container = await render(
      <SidecarChatTab
        controller={asController(controller)}
        {...chatProps(controller, meta, { scope: { sessionId: 'parent-2' } })}
      />,
    )

    expect(container.textContent).toContain('这个侧问属于另一个主会话')
  })

  it('opens the chosen native lineage with the existing question and references, without sending', async () => {
    const controller = makeController()
    const initial = draft({ question: '输入中的问题' })
    const meta = draftSidecarTabMeta('parent-1', initial.requestKey, initial)
    const container = await render(<SidecarChatTab controller={asController(controller)} {...chatProps(controller, meta)} />)
    expect(container.querySelector('textarea')).toBeNull()
    await act(async () => { buttonByText(container, '独立新会话').click() })
    expect(controller.prepare).toHaveBeenCalledWith('parent-1', initial.requestKey, expect.objectContaining({ question: '输入中的问题', creationMode: 'independent' }))
    expect(controller.create).not.toHaveBeenCalled()
    expect(controller.activateTab).not.toHaveBeenCalled()
  })

  it('opens a confirmed selection mode directly without asking again on the right', async () => {
    const controller = makeController()
    const initial = draft({ creationConfirmed: true, creationMode: 'independent' })
    const meta = draftSidecarTabMeta('parent-1', initial.requestKey, initial)
    const container = await render(<SidecarChatTab controller={asController(controller)} {...chatProps(controller, meta)} />)
    expect(controller.prepare).toHaveBeenCalledOnce()
    expect(controller.prepare).toHaveBeenCalledWith('parent-1', initial.requestKey, expect.objectContaining({ creationMode: 'independent' }))
    expect(container.textContent).not.toContain('关联侧问')
    expect(container.textContent).not.toContain('独立新会话')
  })

  it('does not let an already-created hidden draft steal focus after history reload', async () => {
    const r = record()
    const controller = makeController(makeSnapshot({ 'parent-1': [r] }))
    const meta = draftSidecarTabMeta('parent-1', r.requestKey, draft())
    await render(<SidecarChatTab controller={asController(controller)} {...chatProps(controller, meta, { visible: false })} />)
    expect(controller.activateTab).not.toHaveBeenCalled()
  })

  it('preserves a failed preparation for retry without switching tabs', async () => {
    const controller = makeController(); controller.prepare.mockRejectedValueOnce(new Error('offline'))
    const initial = draft(); const meta = draftSidecarTabMeta('parent-1', initial.requestKey, initial)
    const container = await render(<SidecarChatTab controller={asController(controller)} {...chatProps(controller, meta)} />)
    await act(async () => { buttonByText(container, '关联侧问').click() })
    expect(container.textContent).toContain('offline')
    expect(container.textContent).toContain(initial.question)
    expect(buttonByText(container, '关联侧问').disabled).toBe(false)
    expect(controller.activateTab).not.toHaveBeenCalled()
  })

  it('opens a history record and routes archive and restore to the same child', async () => {
    const active = record()
    const controller = makeController(makeSnapshot({ 'parent-1': [active] }))
    const container = await render(
      <SidecarHistoryTab controller={asController(controller)} {...chatProps(controller, undefined)} />,
    )

    await act(async () => { buttonByText(container, 'quoted text').click() })
    expect(controller.openRecord).toHaveBeenCalledWith(active)

    await act(async () => { buttonByText(container, '归档').click(); await Promise.resolve() })
    expect(controller.archive).toHaveBeenCalledWith('parent-1', 'child-1', true)

    const archived = record({ status: 'archived' })
    const archivedController = makeController(makeSnapshot({ 'parent-1': [archived] }))
    const archivedContainer = await render(
      <SidecarHistoryTab controller={asController(archivedController)} {...chatProps(archivedController, undefined)} />,
    )
    await act(async () => { buttonByText(archivedContainer, '恢复').click(); await Promise.resolve() })
    expect(archivedController.archive).toHaveBeenCalledWith('parent-1', 'child-1', false)
  })

  it('does not mount a native surface while the tab is hidden', async () => {
    const controller = makeController(makeSnapshot({ 'parent-1': [record()] }))
    const meta = activeSidecarTabMeta(record())
    const renderConversation = vi.fn(() => null)
    await render(
      <SidecarChatTab
        controller={asController(controller)}
        renderConversation={renderConversation}
        {...chatProps(controller, meta, { visible: false })}
      />,
    )

    expect(renderConversation).not.toHaveBeenCalled()
  })

  it('shows a retry action when the history list fails to load', async () => {
    const controller = makeController({ ...makeSnapshot(), error: '网络暂时不可用' })
    const container = await render(
      <SidecarHistoryTab controller={asController(controller)} {...chatProps(controller, undefined)} />,
    )

    expect(container.textContent).toContain('网络暂时不可用')
    await act(async () => { buttonByText(container, '重试').click(); await Promise.resolve() })
    expect(controller.load).toHaveBeenCalledWith('parent-1')
  })
})

it('offers new sidecars from both empty and populated history', async () => {
  for (const records of [[], [record()]]) {
    const controller = makeController(makeSnapshot({ 'parent-1': records }))
    const container = await render(<SidecarHistoryTab controller={asController(controller)} {...chatProps(controller, activeSidecarTabMeta(record()))} />)
    await act(async () => { buttonByText(container, '新建侧问').click() })
    expect(controller.newFromHistory).toHaveBeenCalledWith('parent-1')
  }
})
it('keeps independent session creation separate from access mode', async () => {
  const controller = makeController()
  const meta = draftSidecarTabMeta('parent-1', 'parent-1:selection:request-1', draft())
  const container = await render(<SidecarChatTab controller={asController(controller)} {...chatProps(controller, meta)} />)
  await act(async () => { buttonByText(container, '独立新会话').click() })
  expect(controller.updateDraft).toHaveBeenCalledWith('parent-1', 'parent-1:selection:request-1', expect.objectContaining({ creationMode: 'independent', accessMode: 'read-only' }))
})

it('sorts active history before archived records without mutating persisted order', async () => {
  const records = [record({ childSessionId: 'old', title: 'old', updatedAt: 1 }), record({ childSessionId: 'archived', title: 'archived', status: 'archived', updatedAt: 3 }), record({ childSessionId: 'recent', title: 'recent', updatedAt: 2 })]
  const controller = makeController(makeSnapshot({ 'parent-1': records }))
  const container = await render(<SidecarHistoryTab controller={asController(controller)} {...chatProps(controller, undefined)} />)
  expect([...container.querySelectorAll('article strong')].map(e => e.textContent)).toEqual(['recent', 'old', 'archived'])
  expect(records.map(r => r.childSessionId)).toEqual(['old', 'archived', 'recent'])
})

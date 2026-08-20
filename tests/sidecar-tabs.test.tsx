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
  IconCloseOutline16: () => null,
  IconSendOutline16: () => null,
}))

type Snapshot = {
  recordsByParent: Record<string, SidecarRecord[]>
  loadingParents: Record<string, boolean>
  optimisticByChild: Record<string, unknown[]>
  error?: string
}

interface FakeController {
  store: {
    subscribe: (listener: () => void) => () => void
    getSnapshot: () => Snapshot
    addOptimistic: ReturnType<typeof vi.fn>
    ackOptimistic: ReturnType<typeof vi.fn>
    setError: ReturnType<typeof vi.fn>
  }
  load: ReturnType<typeof vi.fn>
  updateDraft: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  activateTab: ReturnType<typeof vi.fn>
  mountNativeSurface: ReturnType<typeof vi.fn>
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
    store: {
      subscribe,
      getSnapshot,
      addOptimistic: vi.fn(),
      ackOptimistic: vi.fn(),
      setError: vi.fn(),
    },
    load: vi.fn(async () => undefined),
    updateDraft: vi.fn(),
    create: vi.fn(),
    activateTab: vi.fn(),
    mountNativeSurface: vi.fn(async () => () => undefined),
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

  it('renders the draft access choice and persists read-only/inherit changes', async () => {
    const controller = makeController()
    const meta = draftSidecarTabMeta('parent-1', 'parent-1:selection:request-1', draft())
    const container = await render(
      <SidecarChatTab controller={asController(controller)} {...chatProps(controller, meta)} />,
    )

    const radios = Array.from(container.querySelectorAll('[role="radio"]')) as HTMLButtonElement[]
    expect(radios).toHaveLength(2)
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
    expect(radios[1]?.getAttribute('aria-checked')).toBe('false')

    await act(async () => { radios[1]?.click() })

    expect(radios[1]?.getAttribute('aria-checked')).toBe('true')
    expect(controller.updateDraft).toHaveBeenCalledWith(
      'parent-1',
      'parent-1:selection:request-1',
      expect.objectContaining({ accessMode: 'inherit', requestKey: 'parent-1:selection:request-1' }),
    )
  })

  it('does not send Enter while composing Chinese IME text, then sends after composition ends', async () => {
    const controller = makeController()
    const meta = draftSidecarTabMeta('parent-1', 'parent-1:selection:request-1', draft({ question: '输入中的问题' }))
    controller.create.mockResolvedValue(record())
    const container = await render(
      <SidecarChatTab controller={asController(controller)} {...chatProps(controller, meta)} />,
    )
    const textarea = container.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textarea not found')

    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(controller.create).not.toHaveBeenCalled()

    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })
    expect(controller.create).toHaveBeenCalledOnce()
    expect(controller.create).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'parent-1',
      requestKey: 'parent-1:selection:request-1',
      question: '输入中的问题',
    }))
  })

  it('activates the same stable tab after the first create succeeds', async () => {
    const controller = makeController()
    const initial = draft()
    const meta = draftSidecarTabMeta('parent-1', initial.requestKey, initial)
    const created = record({ requestKey: initial.requestKey, childSessionId: 'child-created' })
    controller.create.mockResolvedValue(created)
    const container = await render(
      <SidecarChatTab controller={asController(controller)} {...chatProps(controller, meta)} />,
    )

    await act(async () => { buttonByText(container, '发送').click(); await Promise.resolve() })

    expect(controller.activateTab).toHaveBeenCalledWith(created)
    expect(controller.store.addOptimistic).toHaveBeenCalledWith(expect.objectContaining({
      childSessionId: 'child-created',
      requestKey: `first:${initial.requestKey}`,
    }))
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
    await render(
      <SidecarChatTab
        controller={asController(controller)}
        {...chatProps(controller, meta, { visible: false })}
      />,
    )

    expect(controller.mountNativeSurface).not.toHaveBeenCalled()
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

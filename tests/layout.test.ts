// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  applyConversationSplit,
  releaseConversationSplit,
  resolveConversationSplitWidth,
} from '../src/client/layout.js'

describe('conversation split layout', () => {
  it('releases every plugin-owned layout value when the drawer closes', () => {
    const host = document.createElement('main')
    applyConversationSplit(host, 520)

    expect(host.dataset.sidecarConversationSplit).toBe('true')
    expect(host.style.getPropertyValue('--dsh-sidecar-conversation-width')).toBe('520px')

    releaseConversationSplit(host)

    expect(host.dataset.sidecarConversationSplit).toBeUndefined()
    expect(host.style.getPropertyValue('--dsh-sidecar-conversation-width')).toBe('')
  })

  it('clears stale inline layout left by the previous implementation', () => {
    const host = document.createElement('main')
    host.style.paddingRight = '520px'
    host.style.boxSizing = 'border-box'
    host.style.transition = 'padding-right 200ms ease'
    host.style.color = 'red'

    releaseConversationSplit(host)

    expect(host.style.paddingRight).toBe('')
    expect(host.style.boxSizing).toBe('')
    expect(host.style.transition).toBe('')
    expect(host.style.color).toBe('red')
  })

  it('keeps main and sidecar conversations beside each other when another desktop plugin narrows the host', () => {
    expect(resolveConversationSplitWidth(782, 440, 1_485)).toEqual({
      width: 422,
      full: false,
    })
  })

  it('balances both conversations when the desktop host cannot preserve the preferred main width', () => {
    expect(resolveConversationSplitWidth(600, 440, 1_485)).toEqual({
      width: 300,
      full: false,
    })
  })

  it('only covers the conversation column on a genuinely small viewport', () => {
    expect(resolveConversationSplitWidth(640, 440, 640)).toEqual({
      width: 640,
      full: true,
    })
  })
})

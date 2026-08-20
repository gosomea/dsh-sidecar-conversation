import type { SidecarDraft, SidecarRecord } from '../core/types.js'

/** Version of the JSON stored in a Better Sidebar tab's `meta` field. */
export const SIDECAR_TAB_META_VERSION = 1 as const

/** Tab types owned by this plugin. Keep these stable once published. */
export const SIDECAR_CHAT_TAB_TYPE = 'dsh-sidecar-conversation:chat' as const
export const SIDECAR_HISTORY_TAB_TYPE = 'dsh-sidecar-conversation:history' as const

const TAB_ID_PREFIX = 'sidecar:'
const TAB_PATH_PREFIX = 'sidecar://'

export interface SidecarDraftTabMeta {
  version: typeof SIDECAR_TAB_META_VERSION
  kind: 'draft'
  parentSessionId: string
  requestKey: string
  draft: SidecarDraft & { requestKey: string }
}

export interface SidecarActiveTabMeta {
  version: typeof SIDECAR_TAB_META_VERSION
  kind: 'active'
  parentSessionId: string
  requestKey: string
  childSessionId: string
}

export type SidecarTabMeta = SidecarDraftTabMeta | SidecarActiveTabMeta

/** The stable Better Sidebar tab id for a Sidecar request. */
export function sidecarTabId(requestKey: string): string {
  return `${TAB_ID_PREFIX}${encodeComponent(requestKey)}`
}

/**
 * A logical path is deliberately included in every open seed. Better Sidebar
 * treats path-bearing opens as content opens and reveals the hosting panel.
 */
export function sidecarTabPath(requestKey: string): string {
  return `${TAB_PATH_PREFIX}${encodeComponent(requestKey)}`
}

/** Create the JSON-safe meta for a not-yet-created Sidecar. */
export function draftSidecarTabMeta(
  parentSessionId: string,
  requestKey: string,
  draft: SidecarDraft,
): SidecarDraftTabMeta {
  assertIdentifier(parentSessionId, 'parentSessionId')
  assertIdentifier(requestKey, 'requestKey')
  return {
    version: SIDECAR_TAB_META_VERSION,
    kind: 'draft',
    parentSessionId,
    requestKey,
    draft: { ...draft, requestKey },
  }
}

/** Create the JSON-safe meta for a forked, persistent Sidecar. */
export function activeSidecarTabMeta(record: Pick<SidecarRecord, 'parentSessionId' | 'requestKey' | 'childSessionId'>): SidecarActiveTabMeta {
  assertIdentifier(record.parentSessionId, 'parentSessionId')
  assertIdentifier(record.requestKey, 'requestKey')
  assertIdentifier(record.childSessionId, 'childSessionId')
  return {
    version: SIDECAR_TAB_META_VERSION,
    kind: 'active',
    parentSessionId: record.parentSessionId,
    requestKey: record.requestKey,
    childSessionId: record.childSessionId,
  }
}

/**
 * Parse a value restored from Better Sidebar's localStorage.
 *
 * This intentionally returns `undefined` for malformed or future-version
 * values. A plugin must never treat arbitrary persisted JSON as a session
 * binding. The nested draft is checked field-by-field as well.
 */
export function parseSidecarTabMeta(value: unknown): SidecarTabMeta | undefined {
  if (!isRecord(value) || value.version !== SIDECAR_TAB_META_VERSION) return undefined
  if (typeof value.kind !== 'string' || !isIdentifier(value.parentSessionId) || !isIdentifier(value.requestKey)) return undefined
  if (value.kind === 'active') {
    return isIdentifier(value.childSessionId)
      ? {
          version: SIDECAR_TAB_META_VERSION,
          kind: 'active',
          parentSessionId: value.parentSessionId,
          requestKey: value.requestKey,
          childSessionId: value.childSessionId,
        }
      : undefined
  }
  if (value.kind !== 'draft' || !isRecord(value.draft)) return undefined
  const draft = parseDraft(value.draft, value.requestKey)
  return draft === undefined
    ? undefined
    : {
        version: SIDECAR_TAB_META_VERSION,
        kind: 'draft',
        parentSessionId: value.parentSessionId,
        requestKey: value.requestKey,
        draft,
      }
}

export function isSidecarTabMeta(value: unknown): value is SidecarTabMeta {
  return parseSidecarTabMeta(value) !== undefined
}

/** Compatibility aliases for callers that prefer a verb-style factory name. */
export const makeSidecarTabId = sidecarTabId
export const makeSidecarTabPath = sidecarTabPath
export const createDraftSidecarTabMeta = draftSidecarTabMeta
export const createActiveSidecarTabMeta = activeSidecarTabMeta

function parseDraft(value: Record<string, unknown>, requestKey: string): (SidecarDraft & { requestKey: string }) | undefined {
  if (
    !isSourceKind(value.sourceKind)
    || !isIdentifier(value.sourceMessageId)
    || !isNonNegativeInteger(value.sourceSeq)
    || typeof value.quote !== 'string'
    || typeof value.question !== 'string'
    || !isAccessMode(value.accessMode)
  ) return undefined
  if (value.requestKey !== undefined && value.requestKey !== requestKey) return undefined
  if (value.forceNew !== undefined && typeof value.forceNew !== 'boolean') return undefined
  return {
    sourceKind: value.sourceKind,
    sourceMessageId: value.sourceMessageId,
    sourceSeq: value.sourceSeq,
    quote: value.quote,
    question: value.question,
    accessMode: value.accessMode,
    requestKey,
    ...(value.forceNew === undefined ? {} : { forceNew: value.forceNew }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSourceKind(value: unknown): value is SidecarDraft['sourceKind'] {
  return value === 'selection' || value === 'turn'
}

function isAccessMode(value: unknown): value is SidecarDraft['accessMode'] {
  return value === 'read-only' || value === 'inherit'
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function assertIdentifier(value: string, name: string): void {
  if (!isIdentifier(value)) throw new TypeError(`${name} must be a non-empty string`)
}

function encodeComponent(value: string): string {
  assertIdentifier(value, 'requestKey')
  return encodeURIComponent(value)
}

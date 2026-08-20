import {
  MAX_QUOTE_LENGTH,
  MAX_QUESTION_LENGTH,
  SIDECAR_UI_STORAGE_KEY,
  type SidecarDraft,
  type SidecarRecord,
  type SidecarSourceKind,
} from '../core/types.js'
import {
  SIDECAR_CHAT_TAB_TYPE,
  activeSidecarTabMeta,
  draftSidecarTabMeta,
  sidecarTabId,
  sidecarTabPath,
  type SidecarTabMeta,
} from './tab-meta.js'

/**
 * The small, JSON-safe part of Better Sidebar's open-tab seed that this
 * migration needs. Keeping this type local means the migration does not
 * import (or require) the optional Better Sidebar package.
 */
export interface SidecarTabSeed {
  id: string
  type: typeof SIDECAR_CHAT_TAB_TYPE
  title: string
  path: string
  meta: SidecarTabMeta
}

/** Minimal storage seam used by the migration. It is deliberately read-only. */
export interface LegacyStorage {
  getItem(key: string): string | null
}

/**
 * Records may be supplied as one flat list, or as the parent-indexed shape
 * already kept by SidecarClientStore. The latter avoids forcing callers to
 * flatten their live store just for migration.
 */
export type SidecarRecordsInput =
  | readonly SidecarRecord[]
  | ReadonlyMap<string, readonly SidecarRecord[]>
  | Readonly<Record<string, readonly SidecarRecord[]>>

export interface LegacyMigrationOptions {
  storage?: LegacyStorage
  records?: SidecarRecordsInput
}

/**
 * Read and convert the old browser UI document into Better Sidebar tab seeds.
 *
 * This function is intentionally side-effect free: it only calls
 * `storage.getItem()`, never writes a migration marker, and never removes or
 * rewrites `dsh.sidecar-conversation.ui.v1`. Better Sidebar's own persisted
 * tab registry is the durable destination, so repeated calls are safe.
 */
export function migrateLegacySidecarTabs(options: LegacyMigrationOptions = {}): SidecarTabSeed[] {
  return migrateLegacySidecarUiState(readLegacySidecarUiState(options.storage), options.records)
}

/** Read the legacy document without interpreting or mutating it. */
export function readLegacySidecarUiState(storage: LegacyStorage | undefined = defaultStorage()): unknown {
  if (storage === undefined) return undefined
  try {
    const encoded = storage.getItem(SIDECAR_UI_STORAGE_KEY)
    if (encoded === null || encoded.trim() === '') return undefined
    return JSON.parse(encoded) as unknown
  } catch {
    // A browser privacy mode can make getItem throw, and a partially-written
    // old value can be invalid JSON. Neither case may prevent Web from booting.
    return undefined
  }
}

/**
 * Pure conversion entry point. It is useful for tests and for hosts that have
 * already read the storage document themselves.
 */
export function migrateLegacySidecarUiState(raw: unknown, recordsInput?: SidecarRecordsInput): SidecarTabSeed[] {
  const parents = parseParents(raw)
  if (parents.length === 0) return []

  const records = flattenRecords(recordsInput)
  const activeByRequest = new Map<string, SidecarTabSeed>()
  const draftByRequest = new Map<string, SidecarTabSeed>()

  for (const parent of parents) {
    const activeRecord = findActiveRecord(records, parent.parentSessionId, parent.activeChildSessionId)
    if (activeRecord !== undefined) {
      const seed = makeActiveSeed(activeRecord)
      // A real registry record is authoritative over a stale draft carrying
      // the same request key. Keep the first active record if corrupt input
      // contains duplicates, making repeated migration deterministic.
      if (!activeByRequest.has(seed.id)) activeByRequest.set(seed.id, seed)
      draftByRequest.delete(seed.id)
    }

    const draft = parseDraft(parent.draft)
    if (draft === undefined) continue
    const requestKey = draft.requestKey ?? deriveLegacyRequestKey(parent.parentSessionId, draft)
    const seed = makeDraftSeed(parent.parentSessionId, requestKey, draft)
    if (!activeByRequest.has(seed.id) && !draftByRequest.has(seed.id)) draftByRequest.set(seed.id, seed)
  }

  return [...activeByRequest.values(), ...draftByRequest.values()]
}

/** Compatibility alias for callers that use the shorter migration name. */
export const migrateLegacyUiState = migrateLegacySidecarUiState

interface ParsedParent {
  parentSessionId: string
  activeChildSessionId?: string
  draft?: unknown
}

interface ParsedDraft {
  sourceKind: SidecarSourceKind
  sourceMessageId: string
  sourceSeq: number
  quote: string
  question: string
  accessMode: SidecarDraft['accessMode']
  forceNew: boolean
  requestKey?: string
}

function parseParents(raw: unknown): ParsedParent[] {
  if (!isRecord(raw) || !isRecord(raw.byParent)) return []
  const result: ParsedParent[] = []
  for (const [parentSessionId, value] of Object.entries(raw.byParent)) {
    if (!isIdentifier(parentSessionId) || !isRecord(value)) continue
    if (value.activeChildSessionId !== undefined && !isIdentifier(value.activeChildSessionId)) continue
    if (value.open !== undefined && typeof value.open !== 'boolean') continue
    if (value.width !== undefined && !isFiniteNumber(value.width)) continue
    result.push({
      parentSessionId,
      ...(value.activeChildSessionId === undefined ? {} : { activeChildSessionId: value.activeChildSessionId }),
      ...(value.draft === undefined ? {} : { draft: value.draft }),
    })
  }
  return result
}

function parseDraft(value: unknown): ParsedDraft | undefined {
  if (!isRecord(value)) return undefined

  const sourceKind = value.sourceKind === undefined ? 'selection' : value.sourceKind
  const accessMode = value.accessMode === undefined ? 'read-only' : value.accessMode
  if (!isSourceKind(sourceKind) || !isAccessMode(accessMode)) return undefined
  if (!isIdentifier(value.sourceMessageId) || !isNonNegativeInteger(value.sourceSeq)) return undefined
  if (typeof value.quote !== 'string' || value.quote.length > MAX_QUOTE_LENGTH) return undefined
  if (typeof value.question !== 'string' || value.question.length > MAX_QUESTION_LENGTH) return undefined
  if (value.forceNew !== undefined && typeof value.forceNew !== 'boolean') return undefined
  if (value.requestKey !== undefined && !isIdentifier(value.requestKey)) return undefined

  return {
    sourceKind,
    sourceMessageId: value.sourceMessageId,
    sourceSeq: value.sourceSeq,
    quote: value.quote,
    question: value.question,
    accessMode,
    forceNew: value.forceNew ?? true,
    ...(value.requestKey === undefined ? {} : { requestKey: value.requestKey }),
  }
}

function makeDraftSeed(parentSessionId: string, requestKey: string, parsed: ParsedDraft): SidecarTabSeed {
  const draft: SidecarDraft = {
    requestKey,
    sourceKind: parsed.sourceKind,
    sourceMessageId: parsed.sourceMessageId,
    sourceSeq: parsed.sourceSeq,
    quote: parsed.quote,
    question: parsed.question,
    accessMode: parsed.accessMode,
    forceNew: parsed.forceNew,
  }
  return {
    id: sidecarTabId(requestKey),
    type: SIDECAR_CHAT_TAB_TYPE,
    title: '侧问',
    path: sidecarTabPath(requestKey),
    meta: draftSidecarTabMeta(parentSessionId, requestKey, draft),
  }
}

function makeActiveSeed(record: SidecarRecord): SidecarTabSeed {
  const title = isIdentifier(record.title) ? record.title : '侧问'
  return {
    id: sidecarTabId(record.requestKey),
    type: SIDECAR_CHAT_TAB_TYPE,
    title,
    path: sidecarTabPath(record.requestKey),
    meta: activeSidecarTabMeta(record),
  }
}

function findActiveRecord(records: readonly SidecarRecord[], parentSessionId: string, childSessionId: string | undefined): SidecarRecord | undefined {
  if (childSessionId === undefined) return undefined
  return records.find(record => (
    record.parentSessionId === parentSessionId
    && record.childSessionId === childSessionId
    && isIdentifier(record.requestKey)
    && record.status !== 'archived'
  ))
}

function flattenRecords(input: SidecarRecordsInput | undefined): SidecarRecord[] {
  if (input === undefined) return []
  if (Array.isArray(input)) return [...input]
  if (input instanceof Map) return [...input.values()].flatMap(items => Array.isArray(items) ? items : [])
  return Object.values(input).flatMap(items => Array.isArray(items) ? items : [])
}

function deriveLegacyRequestKey(parentSessionId: string, draft: ParsedDraft): string {
  // Old documents before requestKey was added were assigned a random key by
  // the old store only when it was loaded. A content-derived key is stable
  // across reloads and therefore cannot create duplicate Better Sidebar tabs.
  const input = [
    parentSessionId,
    draft.sourceKind,
    draft.sourceMessageId,
    String(draft.sourceSeq),
    draft.quote,
    draft.question,
    draft.accessMode,
    draft.forceNew ? '1' : '0',
  ].join('\u001f')
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `legacy-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function defaultStorage(): LegacyStorage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSourceKind(value: unknown): value is SidecarSourceKind {
  return value === 'selection' || value === 'turn'
}

function isAccessMode(value: unknown): value is SidecarDraft['accessMode'] {
  return value === 'read-only' || value === 'inherit'
}

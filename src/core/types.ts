export const SIDECAR_API_PREFIX = '/sidecar-conversation/v1'
export const SIDECAR_UI_STORAGE_KEY = 'dsh.sidecar-conversation.ui.v1'
export const SIDECAR_REGISTRY_VERSION = 2 as const
export const MAX_QUOTE_LENGTH = 4_000
export const MAX_QUESTION_LENGTH = 32_000

export type SidecarSourceKind = 'selection' | 'turn'
export type SidecarAccessMode = 'read-only' | 'inherit'

export interface SidecarAccessSnapshot {
  mode: SidecarAccessMode
  effectiveSandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  effectiveApproval?: 'ask' | 'never'
}

export interface SidecarRecord {
  parentSessionId: string
  childSessionId: string
  requestKey: string
  sourceMessageId: string
  sourceSeq: number
  sourceKind?: SidecarSourceKind
  quote: string
  firstQuestion: string
  firstPromptRpcId: string
  access: SidecarAccessSnapshot
  title: string
  createdAt: number
  updatedAt: number
  status: 'provisioning' | 'active' | 'archived'
}

export interface SidecarDraft {
  sourceKind: SidecarSourceKind
  sourceMessageId: string
  sourceSeq: number
  quote: string
  question: string
  accessMode: SidecarAccessMode
  forceNew?: boolean
}

export interface SidecarParentUiState {
  activeChildSessionId?: string
  open: boolean
  width: number
  draft?: SidecarDraft
}

export interface SidecarUiState {
  byParent: Record<string, SidecarParentUiState>
}

export interface CreateSidecarInput {
  parentSessionId: string
  requestKey: string
  sourceMessageId: string
  sourceSeq: number
  sourceKind?: SidecarSourceKind
  quote: string
  question: string
  accessMode?: SidecarAccessMode
}

export interface PromptSidecarInput {
  childSessionId: string
  requestKey: string
  question: string
  source?: {
    sourceMessageId: string
    sourceSeq: number
    sourceKind: SidecarSourceKind
    quote: string
  }
}

export interface ArchiveSidecarInput {
  childSessionId: string
  archived: boolean
}

export interface HistoryEvent {
  type: string
  seq: number
  time?: number
  data?: unknown
  [key: string]: unknown
}

export interface TranscriptItem {
  key: string
  seq: number
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'error' | 'status'
  text: string
  rpcId?: string
  collapsed?: boolean
  sourceKind?: SidecarSourceKind
  quote?: string
}

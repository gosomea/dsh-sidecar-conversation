import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { SIDECAR_REGISTRY_VERSION, type SidecarRecord } from '../core/types.js'

export interface RegistryFile {
  version: typeof SIDECAR_REGISTRY_VERSION
  records: SidecarRecord[]
  promptReceipts: PromptReceipt[]
}

export interface PromptReceipt {
  childSessionId: string
  rpcId: string
  textHash: string
  status: 'pending' | 'accepted'
  createdAt: number
  updatedAt: number
}

export type RegistryPersistence = (filename: string, snapshot: RegistryFile) => Promise<void>

interface LegacyRegistryFile {
  version: 1
  records: Omit<SidecarRecord, 'access'>[]
}

interface RegistryFileV2 {
  version: 2
  records: SidecarRecord[]
}

interface ParsedRegistryFile {
  version?: unknown
  records?: unknown
  promptReceipts?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isReasonableTimestamp(value: unknown): value is number {
  // Registry timestamps are Date.now()-style millisecond values. Keeping them
  // as non-negative safe integers rejects NaN/Infinity and absurd values while
  // remaining compatible with old fixtures and migrated registries.
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isAccessSnapshot(value: unknown): value is SidecarRecord['access'] {
  if (!isObject(value)) return false
  const item = value as Partial<SidecarRecord['access']>
  return (item.mode === 'read-only' || item.mode === 'inherit')
    && (item.effectiveSandbox === undefined || item.effectiveSandbox === 'read-only' || item.effectiveSandbox === 'workspace-write' || item.effectiveSandbox === 'danger-full-access')
    && (item.effectiveApproval === undefined || item.effectiveApproval === 'ask' || item.effectiveApproval === 'never')
}

function isRecord(value: unknown): value is SidecarRecord {
  if (!isObject(value)) return false
  const item = value as Partial<SidecarRecord>
  return isNonEmptyString(item.parentSessionId)
    && isNonEmptyString(item.childSessionId)
    && isNonEmptyString(item.requestKey)
    && isNonEmptyString(item.sourceMessageId)
    && isNonNegativeSafeInteger(item.sourceSeq)
    && (item.sourceKind === undefined || item.sourceKind === 'selection' || item.sourceKind === 'turn')
    && typeof item.quote === 'string'
    && isNonEmptyString(item.firstQuestion)
    && isNonEmptyString(item.firstPromptRpcId)
    && isAccessSnapshot(item.access)
    && isNonEmptyString(item.title)
    && isReasonableTimestamp(item.createdAt)
    && isReasonableTimestamp(item.updatedAt)
    && item.createdAt <= item.updatedAt
    && (item.status === 'provisioning' || item.status === 'active' || item.status === 'archived')
}

function isLegacyRecord(value: unknown): value is LegacyRegistryFile['records'][number] {
  if (typeof value !== 'object' || value === null) return false
  return isRecord({ ...value, access: { mode: 'inherit' } })
}

function isPromptReceipt(value: unknown): value is PromptReceipt {
  if (!isObject(value)) return false
  const item = value as Partial<PromptReceipt>
  return isNonEmptyString(item.childSessionId)
    && isNonEmptyString(item.rpcId)
    && typeof item.textHash === 'string'
    && /^[a-f0-9]{64}$/.test(item.textHash)
    && (item.status === 'pending' || item.status === 'accepted')
    && isReasonableTimestamp(item.createdAt)
    && isReasonableTimestamp(item.updatedAt)
    && item.createdAt <= item.updatedAt
}

function cloneRecord(record: SidecarRecord): SidecarRecord {
  return { ...record, access: { ...record.access } }
}

function cloneRecords(records: readonly SidecarRecord[]): SidecarRecord[] {
  return records.map(cloneRecord)
}

function cloneReceipt(receipt: PromptReceipt): PromptReceipt { return { ...receipt } }
function cloneReceipts(receipts: readonly PromptReceipt[]): PromptReceipt[] { return receipts.map(cloneReceipt) }

const persistAtomic: RegistryPersistence = async (filename, snapshot) => {
  await mkdir(dirname(filename), { recursive: true })
  const temp = `${filename}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, filename)
    await chmod(filename, 0o600)
    const directory = await open(dirname(filename), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } catch (error: unknown) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

export class SidecarRegistry {
  readonly filename: string
  private records: SidecarRecord[] = []
  private promptReceipts: PromptReceipt[] = []
  private mutationChain: Promise<void> = Promise.resolve()
  private corruptError: Error | undefined

  constructor(
    filename = join(resolveDshHome(), 'sidecar-conversation.json'),
    private readonly persistence: RegistryPersistence = persistAtomic,
  ) {
    this.filename = filename
  }

  async load(): Promise<void> {
    let parsed: unknown
    try {
      const text = await readFile(this.filename, 'utf8')
      parsed = JSON.parse(text) as unknown
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.corruptError = new Error(`sidecar registry is read-only because ${this.filename} is invalid: ${String(error)}`)
      return
    }
    if (!isObject(parsed)) {
      this.corruptError = new Error(`sidecar registry is read-only because ${this.filename} is invalid: unsupported or malformed registry shape`)
      return
    }
    const candidate = parsed as ParsedRegistryFile
    if (candidate.version === 1 && Array.isArray(candidate.records) && candidate.records.every(isLegacyRecord)) {
      this.records = candidate.records.map(item => ({ ...item, access: { mode: 'inherit' } }))
      try { await this.persistSnapshot(this.records, []) }
      catch (error: unknown) { this.corruptError = new Error(`sidecar registry migration could not be persisted: ${String(error)}`) }
      return
    }
    if (candidate.version === 2 && Array.isArray(candidate.records) && candidate.records.every(isRecord)) {
      this.records = cloneRecords(candidate.records as RegistryFileV2['records'])
      try { await this.persistSnapshot(this.records, []) }
      catch (error: unknown) { this.corruptError = new Error(`sidecar registry migration could not be persisted: ${String(error)}`) }
      return
    }
    if (candidate.version !== SIDECAR_REGISTRY_VERSION
      || !Array.isArray(candidate.records)
      || !candidate.records.every(isRecord)
      || !Array.isArray(candidate.promptReceipts)
      || !candidate.promptReceipts.every(isPromptReceipt)) {
      this.corruptError = new Error(`sidecar registry is read-only because ${this.filename} is invalid: unsupported or malformed registry shape`)
      return
    }
    this.records = cloneRecords(candidate.records)
    this.promptReceipts = cloneReceipts(candidate.promptReceipts)
  }

  list(parentSessionId: string, includeArchived = false): SidecarRecord[] {
    return this.records
      .filter(item => item.parentSessionId === parentSessionId
        && (item.status === 'active' || (includeArchived && item.status === 'archived')))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(cloneRecord)
  }

  all(): SidecarRecord[] { return cloneRecords(this.records) }

  getByChild(childSessionId: string): SidecarRecord | undefined {
    const found = this.records.find(item => item.childSessionId === childSessionId)
    return found === undefined ? undefined : cloneRecord(found)
  }

  getByRequest(parentSessionId: string, requestKey: string): SidecarRecord | undefined {
    const found = this.records.find(item => item.parentSessionId === parentSessionId && item.requestKey === requestKey)
    return found === undefined ? undefined : cloneRecord(found)
  }

  getPromptReceipt(childSessionId: string, rpcId: string): PromptReceipt | undefined {
    const found = this.promptReceipts.find(item => item.childSessionId === childSessionId && item.rpcId === rpcId)
    return found === undefined ? undefined : cloneReceipt(found)
  }

  async add(record: SidecarRecord): Promise<SidecarRecord> {
    return this.mutate((records) => {
      if (!isRecord(record)) throw new Error('invalid Sidecar record')
      if (records.some(item => item.childSessionId === record.childSessionId)) throw new Error('child Session is already registered')
      if (records.some(item => item.parentSessionId === record.parentSessionId && item.requestKey === record.requestKey)) {
        throw new Error('requestKey is already registered')
      }
      const next = cloneRecord(record)
      records.push(next)
      return cloneRecord(next)
    })
  }

  async setArchived(childSessionId: string, archived: boolean): Promise<SidecarRecord> {
    return this.mutate((records) => {
      const index = records.findIndex(item => item.childSessionId === childSessionId)
      const current = records[index]
      if (index < 0 || current === undefined) throw new Error('Sidecar is not registered')
      if (current.status === 'provisioning') throw new Error('Sidecar is still being provisioned')
      const next: SidecarRecord = { ...current, status: archived ? 'archived' : 'active', updatedAt: Date.now() }
      records[index] = next
      return cloneRecord(next)
    })
  }

  async activate(childSessionId: string, access: SidecarRecord['access']): Promise<SidecarRecord> {
    return this.mutate((records) => {
      const index = records.findIndex(item => item.childSessionId === childSessionId)
      const current = records[index]
      if (index < 0 || current === undefined) throw new Error('Sidecar is not registered')
      const next: SidecarRecord = { ...current, access: { ...access }, status: 'active', updatedAt: Date.now() }
      records[index] = next
      return cloneRecord(next)
    })
  }

  async reservePrompt(childSessionId: string, rpcId: string, textHash: string): Promise<{ created: boolean; receipt: PromptReceipt }> {
    return this.mutate((records, receipts) => {
      if (!records.some(item => item.childSessionId === childSessionId)) throw new Error('Sidecar is not registered')
      const existing = receipts.find(item => item.childSessionId === childSessionId && item.rpcId === rpcId)
      if (existing !== undefined) {
        if (existing.textHash !== textHash) throw new Error('requestKey is already bound to a different Sidecar prompt')
        return { created: false, receipt: cloneReceipt(existing) }
      }
      const now = Date.now()
      const receipt: PromptReceipt = {
        childSessionId, rpcId, textHash, status: 'pending', createdAt: now, updatedAt: now,
      }
      receipts.push(receipt)
      return { created: true, receipt: cloneReceipt(receipt) }
    })
  }

  async acceptPrompt(childSessionId: string, rpcId: string, textHash: string): Promise<PromptReceipt> {
    return this.mutate((_records, receipts) => {
      const index = receipts.findIndex(item => item.childSessionId === childSessionId && item.rpcId === rpcId)
      const current = receipts[index]
      if (index < 0 || current === undefined) throw new Error('Sidecar prompt receipt is not reserved')
      if (current.textHash !== textHash) throw new Error('requestKey is already bound to a different Sidecar prompt')
      const next: PromptReceipt = { ...current, status: 'accepted', updatedAt: Date.now() }
      receipts[index] = next
      return cloneReceipt(next)
    })
  }

  private async mutate<T>(change: (records: SidecarRecord[], receipts: PromptReceipt[]) => T): Promise<T> {
    this.ensureWritable()
    let result: T | undefined
    const task = this.mutationChain.then(async () => {
      this.ensureWritable()
      const nextRecords = cloneRecords(this.records)
      const nextReceipts = cloneReceipts(this.promptReceipts)
      result = change(nextRecords, nextReceipts)
      await this.persistSnapshot(nextRecords, nextReceipts)
      this.records = nextRecords
      this.promptReceipts = nextReceipts
    })
    this.mutationChain = task.catch(() => undefined)
    await task
    if (result === undefined) throw new Error('registry mutation completed without a result')
    return result
  }

  private async persistSnapshot(records: readonly SidecarRecord[], receipts: readonly PromptReceipt[]): Promise<void> {
    if (this.corruptError !== undefined) throw this.corruptError
    await this.persistence(this.filename, {
      version: SIDECAR_REGISTRY_VERSION,
      records: cloneRecords(records),
      promptReceipts: cloneReceipts(receipts),
    })
  }

  ensureWritable(): void {
    if (this.corruptError !== undefined) throw this.corruptError
  }
}

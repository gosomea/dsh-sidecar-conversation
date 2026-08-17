import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { SIDECAR_REGISTRY_VERSION, type SidecarRecord } from '../core/types.js'

interface RegistryFile {
  version: typeof SIDECAR_REGISTRY_VERSION
  records: SidecarRecord[]
}

interface LegacyRegistryFile {
  version: 1
  records: Omit<SidecarRecord, 'access'>[]
}

interface ParsedRegistryFile {
  version?: unknown
  records?: unknown[]
}

function isRecord(value: unknown): value is SidecarRecord {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<SidecarRecord>
  return typeof item.parentSessionId === 'string'
    && typeof item.childSessionId === 'string'
    && typeof item.requestKey === 'string'
    && typeof item.sourceMessageId === 'string'
    && Number.isInteger(item.sourceSeq)
    && (item.sourceKind === undefined || item.sourceKind === 'selection' || item.sourceKind === 'turn')
    && typeof item.quote === 'string'
    && typeof item.firstQuestion === 'string'
    && typeof item.firstPromptRpcId === 'string'
    && typeof item.access === 'object' && item.access !== null
    && (item.access.mode === 'read-only' || item.access.mode === 'inherit')
    && (item.access.effectiveSandbox === undefined || item.access.effectiveSandbox === 'read-only' || item.access.effectiveSandbox === 'workspace-write' || item.access.effectiveSandbox === 'danger-full-access')
    && (item.access.effectiveApproval === undefined || item.access.effectiveApproval === 'ask' || item.access.effectiveApproval === 'never')
    && typeof item.title === 'string'
    && typeof item.createdAt === 'number'
    && typeof item.updatedAt === 'number'
    && (item.status === 'provisioning' || item.status === 'active' || item.status === 'archived')
}

function isLegacyRecord(value: unknown): value is LegacyRegistryFile['records'][number] {
  if (typeof value !== 'object' || value === null) return false
  return isRecord({ ...value, access: { mode: 'inherit' } })
}

export class SidecarRegistry {
  readonly filename: string
  private records: SidecarRecord[] = []
  private writeChain: Promise<void> = Promise.resolve()
  private corruptError: Error | undefined

  constructor(filename = join(resolveDshHome(), 'sidecar-conversation.json')) {
    this.filename = filename
  }

  async load(): Promise<void> {
    let parsed: ParsedRegistryFile
    try {
      const text = await readFile(this.filename, 'utf8')
      parsed = JSON.parse(text) as ParsedRegistryFile
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.corruptError = new Error(`sidecar registry is read-only because ${this.filename} is invalid: ${String(error)}`)
      return
    }
    if (parsed.version === 1 && Array.isArray(parsed.records) && parsed.records.every(isLegacyRecord)) {
      this.records = parsed.records.map(item => ({ ...item, access: { mode: 'inherit' } }))
      try { await this.persist() }
      catch (error: unknown) { this.corruptError = new Error(`sidecar registry migration could not be persisted: ${String(error)}`) }
      return
    }
    if (parsed.version !== SIDECAR_REGISTRY_VERSION || !Array.isArray(parsed.records) || !parsed.records.every(isRecord)) {
      this.corruptError = new Error(`sidecar registry is read-only because ${this.filename} is invalid: unsupported or malformed registry shape`)
      return
    }
    this.records = parsed.records.map(item => ({ ...item, access: { ...item.access } }))
  }

  list(parentSessionId: string, includeArchived = false): SidecarRecord[] {
    return this.records
      .filter(item => item.parentSessionId === parentSessionId
        && (item.status === 'active' || (includeArchived && item.status === 'archived')))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(item => ({ ...item, access: { ...item.access } }))
  }

  all(): SidecarRecord[] { return this.records.map(item => ({ ...item, access: { ...item.access } })) }

  getByChild(childSessionId: string): SidecarRecord | undefined {
    const found = this.records.find(item => item.childSessionId === childSessionId)
    return found === undefined ? undefined : { ...found, access: { ...found.access } }
  }

  getByRequest(parentSessionId: string, requestKey: string): SidecarRecord | undefined {
    const found = this.records.find(item => item.parentSessionId === parentSessionId && item.requestKey === requestKey)
    return found === undefined ? undefined : { ...found, access: { ...found.access } }
  }

  async add(record: SidecarRecord): Promise<SidecarRecord> {
    this.ensureWritable()
    if (this.getByChild(record.childSessionId) !== undefined) throw new Error('child Session is already registered')
    if (this.getByRequest(record.parentSessionId, record.requestKey) !== undefined) throw new Error('requestKey is already registered')
    this.records.push({ ...record, access: { ...record.access } })
    try { await this.persist() } catch (error: unknown) { this.records.pop(); throw error }
    return { ...record, access: { ...record.access } }
  }

  async setArchived(childSessionId: string, archived: boolean): Promise<SidecarRecord> {
    this.ensureWritable()
    const index = this.records.findIndex(item => item.childSessionId === childSessionId)
    const current = this.records[index]
    if (index < 0 || current === undefined) throw new Error('Sidecar is not registered')
    if (current.status === 'provisioning') throw new Error('Sidecar is still being provisioned')
    const next: SidecarRecord = { ...current, status: archived ? 'archived' : 'active', updatedAt: Date.now() }
    this.records[index] = next
    try { await this.persist() } catch (error: unknown) { this.records[index] = current; throw error }
    return { ...next, access: { ...next.access } }
  }

  async activate(childSessionId: string, access: SidecarRecord['access']): Promise<SidecarRecord> {
    this.ensureWritable()
    const index = this.records.findIndex(item => item.childSessionId === childSessionId)
    const current = this.records[index]
    if (index < 0 || current === undefined) throw new Error('Sidecar is not registered')
    const next: SidecarRecord = { ...current, access: { ...access }, status: 'active', updatedAt: Date.now() }
    this.records[index] = next
    try { await this.persist() } catch (error: unknown) { this.records[index] = current; throw error }
    return { ...next, access: { ...next.access } }
  }

  private async persist(): Promise<void> {
    if (this.corruptError !== undefined) throw this.corruptError
    const snapshot: RegistryFile = {
      version: SIDECAR_REGISTRY_VERSION,
      records: this.records.map(item => ({ ...item, access: { ...item.access } })),
    }
    const task = this.writeChain.then(async () => {
      await mkdir(dirname(this.filename), { recursive: true })
      const temp = `${this.filename}.${process.pid}.${randomUUID()}.tmp`
      const handle = await open(temp, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temp, this.filename)
      await chmod(this.filename, 0o600)
      const directory = await open(dirname(this.filename), 'r')
      try { await directory.sync() } finally { await directory.close() }
    })
    this.writeChain = task.catch(() => undefined)
    await task
  }

  ensureWritable(): void {
    if (this.corruptError !== undefined) throw this.corruptError
  }
}

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SidecarRegistry } from '../src/host/registry.js'
import type { SidecarRecord } from '../src/core/types.js'

function record(overrides: Partial<SidecarRecord> = {}): SidecarRecord {
  return {
    parentSessionId: 'parent-a', childSessionId: 'child-a', requestKey: 'request-a',
    sourceMessageId: 'message-a', sourceSeq: 12, quote: 'quote', firstQuestion: 'question',
    firstPromptRpcId: 'rpc-a', access: { mode: 'read-only', effectiveSandbox: 'read-only', effectiveApproval: 'never' },
    title: '↳ 侧问 · quote', createdAt: 1, updatedAt: 1, status: 'active',
    ...overrides,
  }
}

describe('SidecarRegistry', () => {
  it('persists 0600 JSON and never permits rebinding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-registry-'))
    const filename = join(root, 'registry.json')
    const registry = new SidecarRegistry(filename)
    await registry.load()
    await registry.add(record())
    await expect(registry.add(record({ parentSessionId: 'parent-b' }))).rejects.toThrow(/child Session/)
    expect(registry.list('parent-a')).toHaveLength(1)
    expect(registry.list('parent-b')).toHaveLength(0)
    const persisted = JSON.parse(await readFile(filename, 'utf8')) as { version: number; promptReceipts: unknown[] }
    expect(persisted.version).toBe(3)
    expect(persisted.promptReceipts).toEqual([])
  })

  it('keeps a corrupt file untouched and refuses writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-corrupt-'))
    const filename = join(root, 'registry.json')
    await writeFile(filename, '{broken', 'utf8')
    const registry = new SidecarRegistry(filename)
    await registry.load()
    await expect(registry.add(record())).rejects.toThrow(/read-only/)
    expect(await readFile(filename, 'utf8')).toBe('{broken')
  })

  it.each([null, [], 'not-an-object', 42])('treats a JSON %j top-level value as corrupt read-only state', async (value) => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-corrupt-shape-'))
    const filename = join(root, 'registry.json')
    await writeFile(filename, JSON.stringify(value), 'utf8')
    const registry = new SidecarRegistry(filename)

    await expect(registry.load()).resolves.toBeUndefined()
    await expect(registry.add(record())).rejects.toThrow(/read-only/)
    expect(await readFile(filename, 'utf8')).toBe(JSON.stringify(value))
  })

  it('rejects malformed records instead of loading unsafe identities or counters', async () => {
    const invalidCases: Array<Record<string, unknown>> = [
      { sourceSeq: -1 },
      { sourceSeq: Number.MAX_SAFE_INTEGER + 1 },
      { parentSessionId: '   ' },
      { childSessionId: '' },
      { requestKey: '\n\t' },
      { sourceMessageId: '' },
      { firstQuestion: '  ' },
      { firstPromptRpcId: '' },
      { title: '' },
      { createdAt: -1 },
      { updatedAt: Number.MAX_SAFE_INTEGER + 1 },
      { createdAt: 2, updatedAt: 1 },
    ]

    for (const overrides of invalidCases) {
      const root = await mkdtemp(join(tmpdir(), 'sidecar-invalid-record-'))
      const filename = join(root, 'registry.json')
      await writeFile(filename, JSON.stringify({ version: 3, records: [{ ...record(), ...overrides }], promptReceipts: [] }), 'utf8')
      const registry = new SidecarRegistry(filename)
      await expect(registry.load()).resolves.toBeUndefined()
      await expect(registry.add(record())).rejects.toThrow(/read-only/)
    }
  })

  it('rejects malformed records passed directly to add', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-invalid-add-'))
    const registry = new SidecarRegistry(join(root, 'registry.json'))
    await registry.load()
    await expect(registry.add(record({ sourceSeq: -1 }))).rejects.toThrow(/invalid Sidecar record/)
  })

  it('archives without changing the parent binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-archive-'))
    const registry = new SidecarRegistry(join(root, 'registry.json'))
    await registry.load(); await registry.add(record())
    const archived = await registry.setArchived('child-a', true)
    expect(archived.parentSessionId).toBe('parent-a')
    expect(registry.list('parent-a')).toEqual([])
    expect(registry.list('parent-a', true)[0]?.status).toBe('archived')
  })

  it('migrates v1 records to inherit mode and persists v3', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-migrate-'))
    const filename = join(root, 'registry.json')
    const { access: _access, ...legacy } = record()
    await writeFile(filename, JSON.stringify({ version: 1, records: [legacy] }), 'utf8')
    const registry = new SidecarRegistry(filename)
    await registry.load()
    expect(registry.getByChild('child-a')?.access).toEqual({ mode: 'inherit' })
    expect(JSON.parse(await readFile(filename, 'utf8')).version).toBe(3)
  })

  it('migrates v2 records and starts with an empty prompt receipt ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-migrate-v2-'))
    const filename = join(root, 'registry.json')
    await writeFile(filename, JSON.stringify({ version: 2, records: [record()] }), 'utf8')
    const registry = new SidecarRegistry(filename)
    await registry.load()

    expect(registry.getByChild('child-a')?.childSessionId).toBe('child-a')
    const persisted = JSON.parse(await readFile(filename, 'utf8')) as { version: number; promptReceipts: unknown[] }
    expect(persisted).toMatchObject({ version: 3, promptReceipts: [] })
  })

  it('atomically reserves and accepts prompt receipts without exposing prompt text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-receipt-'))
    const filename = join(root, 'registry.json')
    const registry = new SidecarRegistry(filename)
    await registry.load()
    await registry.add(record())
    const textHash = 'a'.repeat(64)

    const first = await registry.reservePrompt('child-a', 'rpc-next', textHash)
    const repeated = await registry.reservePrompt('child-a', 'rpc-next', textHash)
    expect(first).toMatchObject({ created: true, receipt: { status: 'pending' } })
    expect(repeated).toMatchObject({ created: false, receipt: { status: 'pending' } })
    await registry.acceptPrompt('child-a', 'rpc-next', textHash)

    expect(registry.getPromptReceipt('child-a', 'rpc-next')).toMatchObject({ status: 'accepted', textHash })
    const serialized = await readFile(filename, 'utf8')
    expect(serialized).not.toContain('actual prompt text')
  })

  it('publishes memory only after persistence succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-transaction-'))
    const filename = join(root, 'registry.json')
    let writes = 0
    const registry = new SidecarRegistry(filename, async (_path, snapshot) => {
      writes += 1
      if (writes === 2) throw new Error('disk full')
      await writeFile(filename, JSON.stringify(snapshot), 'utf8')
    })
    await registry.load()
    await registry.add(record())

    await expect(registry.setArchived('child-a', true)).rejects.toThrow('disk full')

    expect(registry.getByChild('child-a')?.status).toBe('active')
    expect(JSON.parse(await readFile(filename, 'utf8')).records[0].status).toBe('active')
  })

  it('serializes concurrent mutations over the latest committed snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-concurrent-'))
    const registry = new SidecarRegistry(join(root, 'registry.json'))
    await registry.load()

    await Promise.all([
      registry.add(record()),
      registry.add(record({ childSessionId: 'child-b', requestKey: 'request-b' })),
    ])

    expect(registry.list('parent-a').map(item => item.childSessionId).sort()).toEqual(['child-a', 'child-b'])
  })
})

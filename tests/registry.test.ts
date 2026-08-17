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
    expect(JSON.parse(await readFile(filename, 'utf8')).version).toBe(2)
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

  it('archives without changing the parent binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-archive-'))
    const registry = new SidecarRegistry(join(root, 'registry.json'))
    await registry.load(); await registry.add(record())
    const archived = await registry.setArchived('child-a', true)
    expect(archived.parentSessionId).toBe('parent-a')
    expect(registry.list('parent-a')).toEqual([])
    expect(registry.list('parent-a', true)[0]?.status).toBe('archived')
  })

  it('migrates v1 records to inherit mode and persists v2', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-migrate-'))
    const filename = join(root, 'registry.json')
    const { access: _access, ...legacy } = record()
    await writeFile(filename, JSON.stringify({ version: 1, records: [legacy] }), 'utf8')
    const registry = new SidecarRegistry(filename)
    await registry.load()
    expect(registry.getByChild('child-a')?.access).toEqual({ mode: 'inherit' })
    expect(JSON.parse(await readFile(filename, 'utf8')).version).toBe(2)
  })
})

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidecarRegistry } from '../src/host/registry.js'
import type { SidecarRecord } from '../src/core/types.js'

const io = vi.hoisted(() => ({ fileError: '', directoryError: '', renameError: '', fileSyncs: 0, directoryOpens: 0, directorySyncs: 0 }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const failure = (code: string, syscall: string) => Object.assign(new Error(`${code}: ${syscall}`), { code, syscall })
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const directory = args[1] === 'r'
      if (directory) io.directoryOpens++
      const handle = await actual.open(...args)
      return {
        writeFile: handle.writeFile.bind(handle),
        close: handle.close.bind(handle),
        sync: async () => {
          if (directory) {
            io.directorySyncs++
            if (process.platform === 'win32') throw failure('EPERM', 'fsync')
            if (io.directoryError) throw failure(io.directoryError, 'fsync')
          } else {
            io.fileSyncs++
            if (io.fileError) throw failure(io.fileError, 'fsync')
          }
          return handle.sync()
        },
      }
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (io.renameError) throw failure(io.renameError, 'rename')
      return actual.rename(...args)
    },
  }
})

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const roots: string[] = []
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  Object.assign(io, { fileError: '', directoryError: '', renameError: '', fileSyncs: 0, directoryOpens: 0, directorySyncs: 0 })
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })))
})
function onPlatform(value: NodeJS.Platform): void { Object.defineProperty(process, 'platform', { ...platform, value }) }
const record = (): SidecarRecord => ({
  parentSessionId: 'parent', childSessionId: 'child', requestKey: 'create', sourceMessageId: 'assistant',
  sourceSeq: 1, sourceKind: 'turn', quote: '', firstQuestion: '', firstPromptRpcId: 'first', nativeComposer: true,
  creationMode: 'fork', access: { mode: 'read-only' }, title: '新侧问', createdAt: 1, updatedAt: 1, status: 'active',
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sidecar-persistence-')); roots.push(root)
  const filename = join(root, 'registry.json')
  const registry = new SidecarRegistry(filename)
  await registry.load()
  return { root, filename, registry }
}

describe('registry filesystem durability', () => {
  it('creates, replaces and reloads on Windows without opening a directory for fsync', async () => {
    const f = await fixture(); onPlatform('win32')
    await f.registry.add(record())
    await f.registry.setTitle('child', 'Windows 侧问')
    const reopened = new SidecarRegistry(f.filename); await reopened.load()
    expect(reopened.getByChild('child')?.title).toBe('Windows 侧问')
    expect(f.registry.getByChild('child')).toEqual(reopened.getByChild('child'))
    expect(io.fileSyncs).toBe(2)
    expect(io.directoryOpens).toBe(0)
    expect(await readdir(f.root)).toEqual(['registry.json'])
  })

  it.each(['EPERM', 'EIO'])('preserves disk and memory on a Windows file fsync %s and allows retry', async code => {
    const f = await fixture(); onPlatform('win32'); await f.registry.add(record())
    const before = await readFile(f.filename, 'utf8'); io.fileError = code
    await expect(f.registry.setTitle('child', 'must not commit')).rejects.toMatchObject({ code, syscall: 'fsync' })
    expect(await readFile(f.filename, 'utf8')).toBe(before)
    expect(f.registry.getByChild('child')?.title).toBe('新侧问')
    expect(await readdir(f.root)).toEqual(['registry.json'])
    io.fileError = ''; await f.registry.setTitle('child', 'retry committed')
    expect(JSON.parse(await readFile(f.filename, 'utf8')).records[0].title).toBe('retry committed')
  })

  it('does not swallow a Windows rename permission error', async () => {
    const f = await fixture(); onPlatform('win32'); await f.registry.add(record())
    const before = await readFile(f.filename, 'utf8'); io.renameError = 'EPERM'
    await expect(f.registry.setArchived('child', true)).rejects.toMatchObject({ code: 'EPERM', syscall: 'rename' })
    expect(await readFile(f.filename, 'utf8')).toBe(before)
    expect(f.registry.getByChild('child')?.status).toBe('active')
    expect(await readdir(f.root)).toEqual(['registry.json'])
  })

  // Directory handles and POSIX mode bits cannot be exercised by a Windows kernel.
  it.skipIf(process.platform === 'win32')('still fsyncs the file and directory on POSIX with owner-only permissions', async () => {
    const f = await fixture(); await f.registry.add(record())
    expect(io.fileSyncs).toBe(1)
    expect(io.directorySyncs).toBe(1)
    expect((await stat(f.filename)).mode & 0o777).toBe(0o600)
  })

  it.skipIf(process.platform === 'win32')('does not suppress a POSIX directory fsync failure', async () => {
    const f = await fixture(); io.directoryError = 'EIO'
    await expect(f.registry.add(record())).rejects.toMatchObject({ code: 'EIO', syscall: 'fsync' })
    expect(io.fileSyncs).toBe(1)
    expect(io.directorySyncs).toBe(1)
    expect(await readdir(f.root)).toEqual(['registry.json'])
  })
})

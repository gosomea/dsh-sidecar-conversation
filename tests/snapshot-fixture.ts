export function createSnapshotStore<T>(value: T) {
  let current = value
  const listeners = new Set<() => void>()
  return { getSnapshot: () => current, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: (next: T) => { current = next; for (const fn of listeners) fn() } }
}

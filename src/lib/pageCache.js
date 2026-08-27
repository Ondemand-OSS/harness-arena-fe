// Small stale-while-revalidate cache for page data.
const PREFIX = 'arena-cache:'
// Expire cached data after five minutes.
const MAX_AGE_MS = 5 * 60 * 1000

// Fall back to memory when storage is unavailable.
const memoryStore = new Map()

export function readCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw != null) {
      const { value, savedAt } = JSON.parse(raw)
      if (Date.now() - savedAt <= MAX_AGE_MS) return value
      return undefined
    }
  } catch {
    /* fall through to the in-memory store below */
  }
  return memoryStore.has(key) ? memoryStore.get(key) : undefined
}

export function writeCache(key, value) {
  memoryStore.set(key, value)
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ value, savedAt: Date.now() }))
  } catch {
    /* localStorage unavailable or full  -  the in-memory fallback above still works for this tab */
  }
}

// Remove cached data affected by a new run.
export function invalidateCache(prefix) {
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) memoryStore.delete(key)
  }
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(PREFIX + prefix)) localStorage.removeItem(key)
    }
  } catch {
    /* Storage can be unavailable; the in-memory cache was still cleared. */
  }
}

// Small stale-while-revalidate cache for page data.
const PREFIX = 'arena-cache:'
// Expire cached data after five minutes.
const MAX_AGE_MS = 5 * 60 * 1000

// Set to true to also persist readCache/writeCache entries in localStorage.
// BattleLog and Evaluate use in-memory page windows by default; localStorage
// is only consulted when this flag is enabled.
export const PERSIST_TO_LOCAL_STORAGE = false

// Fall back to memory when storage is unavailable.
const memoryStore = new Map()

// Per-scope sliding windows: scopeKey -> Map(pageNumber -> data).
// Survives SPA navigation within the same tab; cleared via clearPageWindows().
const pageWindows = new Map()

export function readCache(key) {
  if (memoryStore.has(key)) {
    const entry = memoryStore.get(key)
    return entry?.value ?? entry
  }
  if (!PERSIST_TO_LOCAL_STORAGE) return undefined
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
  return undefined
}

export function writeCache(key, value) {
  memoryStore.set(key, { value, savedAt: Date.now() })
  if (!PERSIST_TO_LOCAL_STORAGE) return
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ value, savedAt: Date.now() }))
  } catch {
    /* localStorage unavailable or full  -  the in-memory fallback above still works for this tab */
  }
}

export function readPageWindow(scopeKey, page) {
  return pageWindows.get(scopeKey)?.get(page)
}

export function writePageWindow(scopeKey, page, data) {
  if (!pageWindows.has(scopeKey)) pageWindows.set(scopeKey, new Map())
  pageWindows.get(scopeKey).set(page, data)
}

export function updatePageWindow(scopeKey, page, updater) {
  const current = readPageWindow(scopeKey, page)
  if (current === undefined) return undefined
  const next = updater(current)
  writePageWindow(scopeKey, page, next)
  return next
}

// Remove cached data affected by a new run.
export function invalidateCache(prefix) {
  clearPageWindows(prefix)
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) memoryStore.delete(key)
  }
  if (!PERSIST_TO_LOCAL_STORAGE) return
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(PREFIX + prefix)) localStorage.removeItem(key)
    }
  } catch {
    /* Storage can be unavailable; the in-memory cache was still cleared. */
  }
}

export function clearPageWindows(prefix) {
  for (const key of pageWindows.keys()) {
    if (key.startsWith(prefix)) pageWindows.delete(key)
  }
}

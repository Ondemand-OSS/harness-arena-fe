// Session-scoped cache for artifact previews and downloaded files.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

const PREVIEW_CACHE = new Map()
const BLOB_CACHE = new Map()
const TEXT_CACHE = new Map()

// Release object URLs when the page closes.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const entry of BLOB_CACHE.values()) URL.revokeObjectURL(entry.blobUrl)
    BLOB_CACHE.clear()
    TEXT_CACHE.clear()
  })
}

/** Types whose renderer needs the original bytes rather than the preview
 *  envelope. */
const BYTE_RENDERED = new Set(['pdf', 'docx', 'pptx'])

/** Types rendered from complete text content. */
const TEXT_RENDERED = new Set(['html', 'htm', 'txt', 'md', 'py', 'json'])

/** Maximum text size rendered in the browser. */
export const FULL_TEXT_MAX = 4_000_000

export function needsBytes(ext) {
  return BYTE_RENDERED.has(ext)
}

export function needsText(ext) {
  return TEXT_RENDERED.has(ext)
}

export function cachedBlobUrl(deliverableId) {
  return BLOB_CACHE.get(deliverableId)?.blobUrl ?? null
}

/** Fetch and cache complete text content. */
export async function fetchArtifactText(deliverableId, { signal } = {}) {
  const hit = TEXT_CACHE.get(deliverableId)
  if (hit) return hit

  const response = await fetch(api.deliverableInlineUrl(deliverableId), { signal })
  if (!response.ok) throw new Error(`Could not load the file (${response.status}).`)
  const raw = await response.text()

  const entry =
    raw.length > FULL_TEXT_MAX
      ? { text: raw.slice(0, FULL_TEXT_MAX), truncated: true, delivered: FULL_TEXT_MAX, original: raw.length }
      : { text: raw, truncated: false, delivered: raw.length, original: raw.length }
  TEXT_CACHE.set(deliverableId, entry)
  return entry
}

/** Download and cache an artifact URL. */
async function downloadBlob(deliverableId, { signal, onProgress }) {
  const hit = BLOB_CACHE.get(deliverableId)
  if (hit) return hit.blobUrl

  const response = await fetch(api.deliverableInlineUrl(deliverableId), { signal })
  if (!response.ok) throw new Error(`Could not load the file (${response.status}).`)

  const declared = Number(response.headers.get('content-length')) || 0
  let blob
  // Progress needs the body read in chunks. Not every response exposes a
  // readable stream (and a proxy may drop content-length), so fall back to
  // .blob() and simply stay indeterminate rather than failing the load.
  if (response.body?.getReader && declared > 0) {
    const reader = response.body.getReader()
    const chunks = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      onProgress?.(Math.min(99, Math.round((received / declared) * 100)))
    }
    blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' })
  } else {
    blob = await response.blob()
  }
  onProgress?.(100)

  // Another mount may have won the race while this one was streaming; keep
  // the first entry so both callers share one object URL.
  const existing = BLOB_CACHE.get(deliverableId)
  if (existing) return existing.blobUrl
  const blobUrl = URL.createObjectURL(blob)
  BLOB_CACHE.set(deliverableId, { blobUrl, size: blob.size })
  return blobUrl
}

/** Load an artifact and its renderer in parallel. */
export function useArtifact(deliverableId, ext, warmRenderer) {
  const wantsBytes = needsBytes(ext)
  const wantsText = needsText(ext)
  // A cache hit must render on the FIRST paint, not after an effect  -  going
  // through 'loading' would flash a skeleton over content already in memory.
  const cachedPreview = deliverableId == null ? null : PREVIEW_CACHE.get(deliverableId)
  const cachedBlob = deliverableId == null ? null : cachedBlobUrl(deliverableId)
  const cachedText = deliverableId == null ? null : TEXT_CACHE.get(deliverableId)
  const warm = Boolean(cachedPreview && (!wantsBytes || cachedBlob) && (!wantsText || cachedText))

  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState(warm ? 'ready' : 'loading')
  const [preview, setPreview] = useState(cachedPreview ?? null)
  const [blobUrl, setBlobUrl] = useState(cachedBlob)
  const [fullText, setFullText] = useState(cachedText ?? null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  // Held in a ref so a changing callback identity can't restart the load.
  const warmRef = useRef(warmRenderer)
  warmRef.current = warmRenderer

  useEffect(() => {
    if (deliverableId == null) {
      setState('loading')
      return undefined
    }
    const hitPreview = PREVIEW_CACHE.get(deliverableId)
    const hitBlob = cachedBlobUrl(deliverableId)
    const hitText = TEXT_CACHE.get(deliverableId)
    if (hitPreview && (!wantsBytes || hitBlob) && (!wantsText || hitText)) {
      setPreview(hitPreview)
      setBlobUrl(hitBlob)
      setFullText(hitText ?? null)
      setProgress(null)
      setError(null)
      setState('ready')
      return undefined
    }

    let cancelled = false
    const controller = new AbortController()
    setState('loading')
    setProgress(null)
    setError(null)

    // All three start together. warmRenderer's rejection is ignored on
    // purpose: it is a prefetch, and the renderer will import() again and
    // surface a real error there if the chunk is genuinely broken.
    warmRef.current?.()?.catch?.(() => {})
    const previewPromise = hitPreview
      ? Promise.resolve(hitPreview)
      : api.deliverablePreview(deliverableId).then((data) => {
          PREVIEW_CACHE.set(deliverableId, data)
          return data
        })
    const blobPromise = wantsBytes
      ? downloadBlob(deliverableId, {
          signal: controller.signal,
          onProgress: (pct) => {
            if (!cancelled) setProgress(pct)
          },
        })
      : Promise.resolve(null)
    // Deliberately non-fatal: if the full file cannot be fetched, the renderer
    // falls back to the preview envelope's clipped copy (with its own
    // truncation banner) rather than failing the whole artifact. A degraded
    // read beats no read.
    const textPromise = wantsText
      ? fetchArtifactText(deliverableId, { signal: controller.signal }).catch((err) => {
          if (err?.name !== 'AbortError') console.warn('[artifact] full text unavailable, using preview:', err)
          return null
        })
      : Promise.resolve(null)

    Promise.all([previewPromise, blobPromise, textPromise])
      .then(([previewData, url, text]) => {
        if (cancelled) return
        setPreview(previewData)
        setBlobUrl(url)
        setFullText(text)
        setState('ready')
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return
        setError(err instanceof Error ? err : new Error(String(err)))
        setState('error')
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [deliverableId, wantsBytes, wantsText, attempt])

  // Retry drops only the failed deliverable's caches  -  a partial download
  // never reached them, so nothing stale is left behind.
  const retry = useCallback(() => {
    if (deliverableId != null) {
      PREVIEW_CACHE.delete(deliverableId)
      TEXT_CACHE.delete(deliverableId)
    }
    setAttempt((n) => n + 1)
  }, [deliverableId])

  return { state, preview, blobUrl, fullText, progress, error, retry }
}

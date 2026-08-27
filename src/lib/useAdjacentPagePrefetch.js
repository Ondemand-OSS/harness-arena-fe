import { useCallback, useEffect, useRef, useState } from 'react'

const NEIGHBOR_RADIUS = 1

/**
 * Session-scoped pagination cache: current page plus one neighbor on each side.
 * Navigating within the window is instant; leaving the section clears the cache
 * when the component unmounts.
 */
export function useAdjacentPagePrefetch({
  page,
  scopeKey,
  fetchPage,
  applyPage,
  hasNextPage,
  onError,
}) {
  const cacheRef = useRef(new Map())
  const scopeRef = useRef(scopeKey)
  const inflightRef = useRef(new Map())
  const [loading, setLoading] = useState(true)

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey
    cacheRef.current = new Map()
    inflightRef.current = new Map()
  }

  const trimCache = useCallback((currentPage) => {
    for (const cachedPage of cacheRef.current.keys()) {
      if (Math.abs(cachedPage - currentPage) > NEIGHBOR_RADIUS) {
        cacheRef.current.delete(cachedPage)
      }
    }
  }, [])

  const fetchAndStore = useCallback(
    async (pageNum) => {
      const cached = cacheRef.current.get(pageNum)
      if (cached !== undefined) return cached

      let promise = inflightRef.current.get(pageNum)
      if (!promise) {
        promise = fetchPage(pageNum)
          .then((data) => {
            cacheRef.current.set(pageNum, data)
            inflightRef.current.delete(pageNum)
            return data
          })
          .catch((error) => {
            inflightRef.current.delete(pageNum)
            throw error
          })
        inflightRef.current.set(pageNum, promise)
      }
      return promise
    },
    [fetchPage]
  )

  const prefetchNeighbors = useCallback(
    (currentPage, currentData) => {
      const targets = []
      if (currentPage > 1) targets.push(currentPage - 1)
      if (hasNextPage(currentPage, currentData)) targets.push(currentPage + 1)
      for (const targetPage of targets) {
        if (cacheRef.current.has(targetPage) || inflightRef.current.has(targetPage)) continue
        fetchAndStore(targetPage).catch(() => {})
      }
    },
    [fetchAndStore, hasNextPage]
  )

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const cached = cacheRef.current.get(page)
      if (cached !== undefined) {
        applyPage(cached)
        setLoading(false)
        trimCache(page)
        prefetchNeighbors(page, cached)
        return
      }

      setLoading(true)
      try {
        const data = await fetchAndStore(page)
        if (cancelled) return
        applyPage(data)
        setLoading(false)
        trimCache(page)
        prefetchNeighbors(page, data)
      } catch (error) {
        if (!cancelled) {
          setLoading(false)
          onError?.(error)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [page, scopeKey, applyPage, fetchAndStore, prefetchNeighbors, trimCache, onError])

  const refreshCurrentPage = useCallback(async () => {
    inflightRef.current.delete(page)
    const data = await fetchPage(page)
    cacheRef.current.set(page, data)
    applyPage(data)
    prefetchNeighbors(page, data)
    return data
  }, [page, fetchPage, applyPage, prefetchNeighbors])

  return { loading, refreshCurrentPage }
}

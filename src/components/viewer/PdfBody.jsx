// Accessible PDF viewer with search, navigation, zoom, and thumbnails.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ViewerSkeleton from './ViewerSkeleton.jsx'
import { ViewerError } from './ViewerError.jsx'

// Load PDF.js only when a PDF is opened.
export const importPdfjs = async () => {
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])
  lib.GlobalWorkerOptions.workerSrc = worker.default
  return lib
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 6
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
// Render this much beyond the visible box, so scrolling at a normal reading
// pace never catches up with the renderer.
const RENDER_MARGIN = '150% 0px'
const THUMB_WIDTH = 92

function clampZoom(v) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))
}

/** Occurrences of `needle` in `haystack`, both already lower-cased. */
function findAll(haystack, needle) {
  const out = []
  if (!needle) return out
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return out
    out.push(at)
    from = at + needle.length
  }
}

/** Wraps every match range inside one page's text-layer spans with <mark>.
 *
 *  The spans are transparent glyph-positioned boxes over the canvas, and a
 *  single match routinely straddles several of them (pdf.js emits a span per
 *  text run, so a word can be split mid-way). So this works in the page's
 *  CONCATENATED text and maps each hit back onto the spans it covers, rather
 *  than doing a per-span substring test that would miss any match crossing a
 *  run boundary. */
function highlightPage(entry, query, firstGlobalIndex) {
  const { spans, offsets, lower } = entry
  // Restore anything a previous query rewrote before measuring again.
  for (const span of spans) {
    if (span.dataset.haMarked) {
      span.textContent = span.dataset.haText
      delete span.dataset.haMarked
    }
  }
  if (!query) return 0

  const hits = findAll(lower, query)
  if (!hits.length) return 0

  // span index -> [{ start, end, global }] in span-local coordinates
  const perSpan = new Map()
  hits.forEach((start, n) => {
    const end = start + query.length
    // offsets[i] is the start of span i; the last entry is the total length.
    for (let i = 0; i < spans.length; i++) {
      const spanStart = offsets[i]
      const spanEnd = offsets[i + 1]
      if (spanEnd <= start) continue
      if (spanStart >= end) break
      const list = perSpan.get(i) ?? []
      list.push({
        start: Math.max(0, start - spanStart),
        end: Math.min(spanEnd - spanStart, end - spanStart),
        global: firstGlobalIndex + n,
      })
      perSpan.set(i, list)
    }
  })

  for (const [i, ranges] of perSpan) {
    const span = spans[i]
    const text = span.dataset.haText
    const frag = document.createDocumentFragment()
    let cursor = 0
    for (const r of ranges) {
      if (r.start > cursor) frag.append(text.slice(cursor, r.start))
      const mark = document.createElement('mark')
      mark.textContent = text.slice(r.start, r.end)
      mark.dataset.haMatch = String(r.global)
      frag.append(mark)
      cursor = r.end
    }
    if (cursor < text.length) frag.append(text.slice(cursor))
    span.replaceChildren(frag)
    span.dataset.haMarked = '1'
  }
  return hits.length
}

export default function PdfBody({
  deliverableId,
  blobUrl,
  filename,
  onToggleFullscreen,
  isFullscreen = false,
}) {
  const surfaceRef = useRef(null)
  const pageRefs = useRef([])
  const pageInputRef = useRef(null)
  const searchInputRef = useRef(null)
  // pageIndex -> { spans, offsets, lower } for pages whose text layer exists.
  const textIndexRef = useRef([])
  // Full per-page text from the document itself, so the match count and the
  // page a match lives on are known for pages that have not been rendered yet.
  const pageTextRef = useRef([])

  const [doc, setDoc] = useState(null)
  const [pageDims, setPageDims] = useState([])
  const [error, setError] = useState(null)
  const [zoom, setZoom] = useState({ mode: 'width', value: 1 })
  const [rotation, setRotation] = useState(0)
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('')
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [matchAt, setMatchAt] = useState(0)
  const [showThumbs, setShowThumbs] = useState(false)
  // Bumped whenever a page's text layer lands, so the highlight pass re-runs
  // for a page that was still lazy when the query was typed.
  const [textEpoch, setTextEpoch] = useState(0)

  const numPages = pageDims.length

  /* ---------------------------------------------------------------- load */
  useEffect(() => {
    if (!blobUrl) return undefined
    let cancelled = false
    let loaded = null
    setError(null)
    setDoc(null)
    setPageDims([])
    setPage(1)
    setRotation(0)
    setQuery('')
    setMatches([])
    textIndexRef.current = []
    pageTextRef.current = []

    ;(async () => {
      try {
        const pdfjs = await importPdfjs()
        if (cancelled) return
        loaded = await pdfjs.getDocument({ url: blobUrl }).promise
        if (cancelled) return
        // Unrotated CSS dimensions per page, so every page box can be sized
        // correctly before its canvas exists  -  no layout shift as lazy
        // pages fill in, and the scrollbar is honest from the first paint.
        const dims = []
        for (let i = 1; i <= loaded.numPages; i++) {
          const p = await loaded.getPage(i)
          if (cancelled) return
          const v = p.getViewport({ scale: 1 })
          dims.push({ w: v.width, h: v.height })
        }
        if (cancelled) return
        setDoc(loaded)
        setPageDims(dims)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      }
    })()

    return () => {
      cancelled = true
      // pdf.js's own teardown can throw if a render was mid-abort; a failed
      // destroy in a cleanup function is genuinely uncaught by React and
      // would unmount the whole app.
      try {
        loaded?.destroy?.()
      } catch (err) {
        console.warn('[PdfBody] document teardown failed (ignored):', err)
      }
    }
  }, [blobUrl])

  /* Document-wide text, for search over pages that are not rendered yet. */
  useEffect(() => {
    if (!doc) return undefined
    let cancelled = false
    ;(async () => {
      const texts = []
      for (let i = 1; i <= doc.numPages; i++) {
        try {
          const p = await doc.getPage(i)
          const content = await p.getTextContent()
          if (cancelled) return
          texts[i - 1] = content.items.map((it) => it.str ?? '').join('')
        } catch {
          texts[i - 1] = ''
        }
      }
      if (!cancelled) {
        pageTextRef.current = texts
        setTextEpoch((n) => n + 1)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  /* ------------------------------------------------------------- geometry */
  useLayoutEffect(() => {
    const el = surfaceRef.current
    if (!el) return undefined
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rotated = rotation % 180 !== 0
  const maxDims = useMemo(() => {
    let w = 0
    let h = 0
    for (const d of pageDims) {
      w = Math.max(w, rotated ? d.h : d.w)
      h = Math.max(h, rotated ? d.w : d.h)
    }
    return { w, h }
  }, [pageDims, rotated])

  // 32px of .ha-page-stack padding, plus a little room so fit-width never
  // itself creates the horizontal scrollbar it is meant to avoid.
  const scale = useMemo(() => {
    if (!maxDims.w || !box.width) return zoom.mode === 'fixed' ? zoom.value : 1
    const fitWidth = (box.width - 40) / maxDims.w
    if (zoom.mode === 'width') return clampZoom(fitWidth)
    if (zoom.mode === 'page') return clampZoom(Math.min(fitWidth, (box.height - 40) / maxDims.h))
    return clampZoom(zoom.value)
  }, [zoom, maxDims, box])

  /* --------------------------------------------------------------- render */
  // Re-render every page from scratch whenever the scale or rotation changes:
  // a canvas rasterised for one scale is the wrong resolution for another.
  useEffect(() => {
    // Wait for the first measurement. Rendering at the placeholder scale of 1
    // and then immediately re-rendering at the real fit-width scale would
    // rasterise every visible page twice for nothing.
    if (!doc || !numPages || !box.width) return undefined
    let cancelled = false
    const tasks = new Map()
    const rendered = new Set()
    textIndexRef.current = []

    for (const wrapper of pageRefs.current) wrapper?.replaceChildren()

    async function renderPage(num) {
      if (cancelled || rendered.has(num) || tasks.has(num)) return
      const wrapper = pageRefs.current[num - 1]
      if (!wrapper) return
      tasks.set(num, null)
      try {
        const pdfjs = await importPdfjs()
        const p = await doc.getPage(num)
        if (cancelled) return
        const viewport = p.getViewport({ scale, rotation })

        // HA-VW: the audited build rasterised at a flat 1.0 while the display
        // ran at devicePixelRatio 1.25, so every glyph was upscaled 25% by
        // the compositor. Capped at 3 so a phone at DPR 4 does not allocate a
        // canvas the GPU refuses.
        const dpr = Math.min(window.devicePixelRatio || 1, 3)
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`

        const task = p.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
          transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
        })
        tasks.set(num, task)
        await task.promise
        if (cancelled) return

        // The real text layer. Everything selection-, search-, copy- and
        // screen-reader-shaped depends on this existing at all.
        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        const textLayer = new pdfjs.TextLayer({
          textContentSource: p.streamTextContent(),
          container: textDiv,
          viewport,
        })
        await textLayer.render()
        if (cancelled) return

        wrapper.replaceChildren(canvas, textDiv)
        rendered.add(num)

        // Index the spans for in-document find. Only spans that actually
        // carry text get appended by pdf.js; the rest are placeholders.
        const spans = textLayer.textDivs.filter((d) => d.textContent)
        const offsets = [0]
        let all = ''
        for (const span of spans) {
          span.dataset.haText = span.textContent
          all += span.textContent
          offsets.push(all.length)
        }
        textIndexRef.current[num - 1] = { spans, offsets, lower: all.toLowerCase() }
        setTextEpoch((n) => n + 1)
      } catch (err) {
        if (cancelled || err?.name === 'RenderingCancelledException') return
        console.error('[PdfBody] page render failed', num, err)
      } finally {
        tasks.delete(num)
      }
    }

    // Lazy: paint what is on screen (plus a margin) and nothing else, so page
    // one appears immediately instead of after all seven.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) renderPage(Number(e.target.dataset.page))
        }
      },
      { root: surfaceRef.current, rootMargin: RENDER_MARGIN }
    )
    for (const wrapper of pageRefs.current) if (wrapper) io.observe(wrapper)

    return () => {
      cancelled = true
      io.disconnect()
      for (const task of tasks.values()) {
        try {
          task?.cancel?.()
        } catch {
          /* already finished or already cancelled */
        }
      }
    }
  }, [doc, numPages, scale, rotation, box.width])

  /* Current page: whichever page box covers the top third of the viewport. */
  useEffect(() => {
    const el = surfaceRef.current
    if (!el || !numPages) return undefined
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const probe = el.scrollTop + el.clientHeight / 3
        let current = 1
        for (let i = 0; i < pageRefs.current.length; i++) {
          const w = pageRefs.current[i]
          if (w && w.offsetTop <= probe) current = i + 1
          else break
        }
        setPage(current)
      })
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [numPages, scale, rotation])

  /* --------------------------------------------------------------- search */
  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      for (const entry of textIndexRef.current) if (entry) highlightPage(entry, '', 0)
      setMatches([])
      setMatchAt(0)
      return
    }
    // Counted from the document's own text so the total is right even for
    // pages that have not been rasterised yet; highlighted wherever a text
    // layer already exists.
    const found = []
    for (let i = 0; i < numPages; i++) {
      const hits = findAll((pageTextRef.current[i] ?? '').toLowerCase(), q)
      for (let n = 0; n < hits.length; n++) found.push({ page: i + 1, nth: n })
      const entry = textIndexRef.current[i]
      if (entry) highlightPage(entry, q, found.length - hits.length)
    }
    setMatches(found)
    setMatchAt((prev) => (prev < found.length ? prev : 0))
  }, [query, numPages, textEpoch])

  /* Scroll the active match into view and tint it differently.
     This effect also re-runs whenever a lazy page's text layer lands, because
     that is how a match on an unrendered page eventually gets highlighted.
     `scrolledToRef` is what keeps that from yanking the reader back to the
     current match every time another page finishes rendering: the jump
     happens once per match, when its mark actually exists. */
  const scrolledToRef = useRef(-1)
  useEffect(() => {
    scrolledToRef.current = -1
  }, [query])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    for (const mark of el.querySelectorAll('mark.ha-match-current')) {
      mark.classList.remove('ha-match-current')
    }
    if (!matches.length) return
    const target = matches[matchAt]
    if (!target) return
    const mark = el.querySelector(`mark[data-ha-match="${matchAt}"]`)
    if (mark) {
      mark.classList.add('ha-match-current')
      if (scrolledToRef.current !== matchAt) {
        mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
        scrolledToRef.current = matchAt
      }
      return
    }
    // The match is on a page that has not been rasterised yet, so it has no
    // mark to scroll to. Scrolling to the page triggers its render, and this
    // effect runs again once the text layer lands  -  deliberately WITHOUT
    // recording the scroll, so the precise jump still happens then.
    const wrapper = pageRefs.current[target.page - 1]
    if (wrapper && scrolledToRef.current !== matchAt) {
      el.scrollTo({ top: wrapper.offsetTop - 12, behavior: 'smooth' })
    }
  }, [matchAt, matches, textEpoch])

  /* -------------------------------------------------------------- actions */
  const goToPage = useCallback(
    (num) => {
      const clamped = Math.min(Math.max(1, num), Math.max(1, numPages))
      const wrapper = pageRefs.current[clamped - 1]
      const el = surfaceRef.current
      if (wrapper && el) el.scrollTo({ top: wrapper.offsetTop - 12, behavior: 'smooth' })
      setPage(clamped)
    },
    [numPages]
  )

  const stepZoom = useCallback(
    (dir) => {
      setZoom((prev) => {
        const from = prev.mode === 'fixed' ? prev.value : scale
        const next =
          dir > 0
            ? (ZOOM_STEPS.find((s) => s > from + 0.001) ?? ZOOM_MAX)
            : ([...ZOOM_STEPS].reverse().find((s) => s < from - 0.001) ?? ZOOM_MIN)
        return { mode: 'fixed', value: clampZoom(next) }
      })
    },
    [scale]
  )

  const commitPageDraft = useCallback(() => {
    const n = Number.parseInt(pageDraft, 10)
    if (Number.isInteger(n)) goToPage(n)
    setPageDraft('')
    surfaceRef.current?.focus()
  }, [pageDraft, goToPage])

  /* Keyboard contract, scoped to the viewer  -  HA-VW-05.
     The audit's most concrete measurement: with focus on the PDF tab button a
     real ArrowDown moved window.scrollY 556 -> 596 while the artifact stayed
     at scrollTop 0, because the element owning the content carried
     tabindex="-1" and was absent from the tab order. tabIndex 0 on the
     scroller is what makes the arrow keys, PageUp/PageDown, Home and End act
     on the document natively; this handler adds the rest, and bails out
     whenever focus is in a field so it never fights the toolbar's own
     inputs. */
  const onKeyDown = useCallback(
    (e) => {
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        if (e.key === 'Escape') surfaceRef.current?.focus()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      let handled = true
      if (!mod && (e.key === 'PageDown' || e.key === 'j' || e.key === 'J')) goToPage(page + 1)
      else if (!mod && (e.key === 'PageUp' || e.key === 'k' || e.key === 'K')) goToPage(page - 1)
      else if (mod && e.key.toLowerCase() === 'g') pageInputRef.current?.focus()
      else if (mod && (e.key === '-' || e.key === '_')) stepZoom(-1)
      else if (mod && (e.key === '=' || e.key === '+')) stepZoom(1)
      else if (mod && e.key === '0') setZoom({ mode: 'width', value: 1 })
      else if (mod && e.key === '9') setZoom({ mode: 'page', value: 1 })
      else if (mod && e.key.toLowerCase() === 'f') searchInputRef.current?.focus()
      else if (!mod && (e.key === 'r' || e.key === 'R')) setRotation((r) => (r + 90) % 360)
      else if (!mod && (e.key === 't' || e.key === 'T')) setShowThumbs((s) => !s)
      else if (!mod && (e.key === 'f' || e.key === 'F')) onToggleFullscreen?.()
      else if (e.key === 'Escape' && query) setQuery('')
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    [page, query, goToPage, stepZoom, onToggleFullscreen]
  )

  if (error) {
    return <ViewerError error={error} deliverableId={deliverableId} filename={filename} />
  }

  const zoomLabel = zoom.mode === 'width' ? 'Fit width' : zoom.mode === 'page' ? 'Fit page' : `${Math.round(scale * 100)}%`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* HA-VW-03: the toolbar the product had no place to put, because there
          was no viewer layer to put it in. Sticky, so it is still there on
          page 6 of 7. */}
      <div className="ha-viewer-toolbar" role="toolbar" aria-label={`${filename} viewer controls`}>
        <div className="ha-tool-group">
          <button
            type="button"
            className="ha-tool"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page (Page Up)"
            title="Previous page  -  PgUp or K"
          >
            ‹
          </button>
          {/* HA-VW-18: a real counter tied to the scroll position, replacing
              the static "7 page document" label. */}
          <label className="ha-tool-count">
            <span className="sr-only">Page number</span>
            <input
              ref={pageInputRef}
              className="ha-tool-input"
              inputMode="numeric"
              value={pageDraft === '' ? page : pageDraft}
              onChange={(e) => setPageDraft(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={commitPageDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitPageDraft()
              }}
              aria-label={`Page ${page} of ${numPages || '?'}. Type a page number and press Enter.`}
              title="Go to page  -  Ctrl+G"
            />
          </label>
          <span className="ha-tool-count">of {numPages || '–'}</span>
          <button
            type="button"
            className="ha-tool"
            onClick={() => goToPage(page + 1)}
            disabled={!numPages || page >= numPages}
            aria-label="Next page (Page Down)"
            title="Next page  -  PgDn or J"
          >
            ›
          </button>
        </div>

        <span className="ha-tool-sep" aria-hidden="true" />

        <div className="ha-tool-group">
          <button
            type="button"
            className="ha-tool"
            onClick={() => stepZoom(-1)}
            disabled={scale <= ZOOM_MIN + 0.001}
            aria-label="Zoom out"
            title="Zoom out  -  Ctrl+-"
          >
            −
          </button>
          <span className="ha-tool-count" aria-live="off">
            {zoomLabel}
          </span>
          <button
            type="button"
            className="ha-tool"
            onClick={() => stepZoom(1)}
            disabled={scale >= ZOOM_MAX - 0.001}
            aria-label="Zoom in"
            title="Zoom in  -  Ctrl++"
          >
            +
          </button>
          <button
            type="button"
            className={`ha-tool ${zoom.mode === 'width' ? 'ha-tool-active' : ''}`}
            onClick={() => setZoom({ mode: 'width', value: 1 })}
            aria-pressed={zoom.mode === 'width'}
            title="Fit width  -  Ctrl+0"
          >
            Fit width
          </button>
          <button
            type="button"
            className={`ha-tool ${zoom.mode === 'page' ? 'ha-tool-active' : ''}`}
            onClick={() => setZoom({ mode: 'page', value: 1 })}
            aria-pressed={zoom.mode === 'page'}
            title="Fit page  -  Ctrl+9"
          >
            Fit page
          </button>
        </div>

        <span className="ha-tool-sep" aria-hidden="true" />

        {/* HA-VW-03/04: find is only possible at all because the text layer
            now exists. Match count and next/previous, as specified. */}
        <div className="ha-tool-group">
          <input
            ref={searchInputRef}
            className="ha-tool-input ha-tool-search"
            type="search"
            value={query}
            placeholder="Find in document"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.length) {
                e.preventDefault()
                setMatchAt((i) => (e.shiftKey ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length))
              }
            }}
            aria-label="Find in document (Ctrl+F)"
          />
          <span className="ha-tool-count" role="status" aria-live="polite">
            {query.trim() ? (matches.length ? `${matchAt + 1}/${matches.length}` : 'no matches') : ''}
          </span>
          <button
            type="button"
            className="ha-tool"
            disabled={!matches.length}
            onClick={() => setMatchAt((i) => (i - 1 + matches.length) % matches.length)}
            aria-label="Previous match"
          >
            ‹
          </button>
          <button
            type="button"
            className="ha-tool"
            disabled={!matches.length}
            onClick={() => setMatchAt((i) => (i + 1) % matches.length)}
            aria-label="Next match"
          >
            ›
          </button>
        </div>

        <span className="ha-tool-sep" aria-hidden="true" />

        <div className="ha-tool-group">
          <button
            type="button"
            className="ha-tool"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            aria-label="Rotate 90 degrees clockwise"
            title="Rotate  -  R"
          >
            ⟳
          </button>
          <button
            type="button"
            className={`ha-tool ${showThumbs ? 'ha-tool-active' : ''}`}
            onClick={() => setShowThumbs((s) => !s)}
            aria-pressed={showThumbs}
            title="Toggle thumbnails  -  T"
          >
            Pages
          </button>
          {onToggleFullscreen && (
            <button
              type="button"
              className={`ha-tool ${isFullscreen ? 'ha-tool-active' : ''}`}
              onClick={onToggleFullscreen}
              aria-pressed={isFullscreen}
              title="Fullscreen  -  F"
            >
              {isFullscreen ? 'Exit' : 'Fullscreen'}
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {showThumbs && numPages > 0 && (
          <ThumbnailRail doc={doc} pageDims={pageDims} numPages={numPages} page={page} onSelect={goToPage} />
        )}

        {/* HA-VW-05/07: the single scroll context, and the element that holds
            focus. role="document" with an accessible name is what puts it in
            the tab order between the artifact tabs and the score controls. */}
        <div
          ref={surfaceRef}
          className="ha-viewer-surface bg-floating"
          role="document"
          tabIndex={0}
          aria-label={`${filename}, ${numPages || 'unknown'} page document. Use the arrow keys to scroll.`}
          aria-describedby="ha-pdf-help"
          onKeyDown={onKeyDown}
        >
          {!numPages ? (
            <ViewerSkeleton label="Rendering document…" />
          ) : (
            <div className="ha-page-stack">
              {pageDims.map((d, i) => {
                const w = (rotated ? d.h : d.w) * scale
                const h = (rotated ? d.w : d.h) * scale
                return (
                  <div
                    key={i}
                    ref={(el) => {
                      pageRefs.current[i] = el
                    }}
                    data-page={i + 1}
                    className="ha-pdf-page"
                    style={{
                      width: `${Math.floor(w)}px`,
                      height: `${Math.floor(h)}px`,
                      // Both are read by pdf.js's setLayerDimensions when it
                      // sizes the text layer.
                      '--total-scale-factor': scale,
                    }}
                    aria-label={`Page ${i + 1} of ${numPages}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* HA-VW-18: the footer is a live counter now, and the polite region
          announces page changes without stuttering on every scroll tick. */}
      <p className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-floating px-3 py-1.5 font-mono-arena text-[11px] text-ink-2">
        <span>
          Page {page} of {numPages || '–'}
        </span>
        <span className="hidden sm:inline">PgDn/J next · Ctrl+F find · Ctrl+0 fit width · R rotate · F fullscreen</span>
      </p>
      <PageAnnouncer filename={filename} page={page} numPages={numPages} />
      <p id="ha-pdf-help" className="sr-only">
        Press Page Down or J for the next page, Page Up or K for the previous page, Control plus F to search inside the
        document, Control plus zero to fit the width, R to rotate and F for fullscreen.
      </p>
    </div>
  )
}

/** Polite, debounced page announcements. Page-change events fire far faster
 *  during a scroll than a screen reader can speak, and an undebounced live
 *  region becomes an unusable stutter  -  350 ms is the report's figure. */
function PageAnnouncer({ filename, page, numPages }) {
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!numPages) return undefined
    const id = setTimeout(() => setMessage(`Page ${page} of ${numPages}`), 350)
    return () => clearTimeout(id)
  }, [page, numPages, filename])
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  )
}

/** Collapsible page rail, for jumping without scrolling through everything in
 *  between. Collapsed by default so it costs no horizontal space until asked
 *  for, and rendered at a fixed small width  -  these are navigation targets,
 *  not a second reading surface. */
function ThumbnailRail({ doc, pageDims, numPages, page, onSelect }) {
  const railRef = useRef(null)
  const slotRefs = useRef([])

  useEffect(() => {
    if (!doc) return undefined
    let cancelled = false
    const tasks = []
    ;(async () => {
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) return
        const slot = slotRefs.current[i - 1]
        if (!slot || slot.dataset.haDone) continue
        try {
          const p = await doc.getPage(i)
          if (cancelled) return
          const base = p.getViewport({ scale: 1 })
          const viewport = p.getViewport({ scale: THUMB_WIDTH / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.className = 'block bg-white'
          const task = p.render({ canvasContext: canvas.getContext('2d'), viewport })
          tasks.push(task)
          await task.promise
          if (cancelled) return
          slot.replaceChildren(canvas)
          slot.dataset.haDone = '1'
        } catch (err) {
          if (err?.name !== 'RenderingCancelledException') console.warn('[PdfBody] thumbnail failed', i, err)
        }
      }
    })()
    return () => {
      cancelled = true
      for (const t of tasks) {
        try {
          t?.cancel?.()
        } catch {
          /* already settled */
        }
      }
    }
  }, [doc, numPages])

  return (
    <div
      ref={railRef}
      className="shrink-0 overflow-y-auto border-r border-line bg-elevated p-2"
      style={{ width: THUMB_WIDTH + 24, overscrollBehavior: 'contain' }}
      aria-label="Page thumbnails"
    >
      <ul className="space-y-2">
        {pageDims.map((_, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelect(i + 1)}
              aria-current={page === i + 1 ? 'true' : undefined}
              aria-label={`Go to page ${i + 1}`}
              className={`block w-full rounded border p-0.5 ${
                page === i + 1 ? 'border-cta' : 'border-line hover:border-line-strong'
              }`}
            >
              <span
                ref={(el) => {
                  slotRefs.current[i] = el
                }}
                className="block bg-surface"
                style={{ minHeight: 40 }}
              />
              <span className="block pt-0.5 text-center font-mono-arena text-[9px] text-ink-2">{i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

import { renderAsync } from 'docx-preview'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { needsBytes, useArtifact } from '../lib/artifactBlobs.js'
import PdfBody, { importPdfjs } from './viewer/PdfBody.jsx'
import ViewerSkeleton from './viewer/ViewerSkeleton.jsx'
import { ViewerError, ViewerErrorBoundary } from './viewer/ViewerError.jsx'

// Renderer cleanup must not interrupt the surrounding UI.
function safeDestroy(obj) {
  try {
    obj?.destroy?.()
  } catch (err) {
    console.warn('[FileViewer] renderer teardown failed (ignored):', err)
  }
}

// Detect outdated code-split assets.
function isChunkLoadError(err) {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /dynamically imported module|loading chunk|importing a module script failed/i.test(message)
}

function reloadOnceForStaleChunk() {
  const key = 'ha-stale-chunk-reload'
  if (sessionStorage.getItem(key)) return false
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    // Reload even when session storage is unavailable.
  }
  window.location.reload()
  return true
}

// One-letter badge per file type, so a file tab is scannable at a glance.
const TYPE_BADGE = {
  xlsx: 'X',
  xlsm: 'X',
  csv: 'X',
  docx: 'D',
  pdf: 'P',
  pptx: 'S',
  html: 'H',
  htm: 'H',
  txt: 'T',
  md: 'M',
  json: 'J',
  py: 'Y',
}

export function fileExt(filename) {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase()
}

/** Load a renderer on demand. */
function warmRendererFor(ext) {
  if (ext === 'pdf') return importPdfjs
  if (ext === 'pptx') return () => import('@aiden0z/pptx-renderer')
  return null
}

/** Accessible tabs for a deliverable's files. */
export function FileTabs({ files, activeId, onSelect }) {
  const refs = useRef({})

  const onKeyDown = (e) => {
    const order = files.map((f) => f.id)
    const i = order.indexOf(activeId)
    let next = null
    if (e.key === 'ArrowRight') next = order[(i + 1) % order.length]
    else if (e.key === 'ArrowLeft') next = order[(i - 1 + order.length) % order.length]
    else if (e.key === 'Home') next = order[0]
    else if (e.key === 'End') next = order[order.length - 1]
    else return
    e.preventDefault()
    onSelect(next)
    // Roving focus follows selection, so only one tab is ever a tab stop.
    refs.current[next]?.focus()
  }

  return (
    <div
      className="ha-artifact-tabs"
      role="tablist"
      aria-label="Deliverables for this output"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
    >
      {files.map((f) => {
        const on = f.id === activeId
        return (
          <button
            key={f.id}
            ref={(el) => {
              refs.current[f.id] = el
            }}
            id={`ha-tab-${f.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`ha-panel-${f.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(f.id)}
            title={f.filename}
            className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono-arena text-[11px] transition-colors ${
              on
                ? 'border-line-strong bg-elevated text-ink'
                : 'border-line bg-floating text-ink-2 hover:text-ink'
            }`}
          >
            <span
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-line-strong text-[9px] font-semibold text-ink"
              aria-hidden="true"
            >
              {TYPE_BADGE[fileExt(f.filename)] ?? '·'}
            </span>
            <span className="max-w-[16rem] truncate">{f.filename}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Spreadsheet-style column labels (A, B, … Z, AA). The audited table showed
 *  row numbers but no column letters, which makes a rubric note like "the
 *  figure in column F" impossible to write. */
function columnLabel(index) {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

function SheetBody({ sheets, truncatedSheets, degraded, deliverableId, filename }) {
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [sheets])
  const sheet = sheets?.[active]
  if (!sheet) return <Empty>This workbook has no readable sheets.</Empty>

  const rows = sheet.rows ?? []
  // `unreadable` is a distinct flag; older payloads folded it into
  // truncated_rows, so infer it from that when it is absent. Reading it this
  // way means the viewer says something true against either backend.
  const unreadable = sheet.unreadable ?? Boolean(sheet.truncated_rows)
  // Treat a fully-populated first row as a header  -  how these evidence
  // workbooks are actually laid out.
  const header = rows.length > 1 && rows[0].every((c) => c !== '') ? rows[0] : null
  const body = header ? rows.slice(1) : rows
  const width = Math.max(header?.length ?? 0, ...body.map((r) => r.length), 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The workbook only parsed via a fallback path. `formula-text` in
          particular means these cells are formula SOURCE, not computed
          results — a judge must not read them as values. */}
      {degraded === 'formula-text' && (
        <div className="ha-banner" role="status" aria-live="polite">
          <strong className="font-semibold">Showing formula text.</strong>
          <span>
            This workbook stores no calculated results, so these cells show the formulas themselves rather than
            their values.
          </span>
        </div>
      )}
      {sheets.length > 1 && (
        <div
          className="ha-artifact-tabs border-b border-line bg-floating px-3 py-2.5"
          role="tablist"
          aria-label="Worksheets"
        >
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              className={`rounded-md px-3 py-1.5 font-mono-arena text-[13px] font-medium transition-colors ${
                i === active ? 'bg-cta text-on-cta' : 'bg-elevated text-ink-2 hover:text-ink'
              }`}
            >
              {s.name}
              {/* A sheet that yielded nothing is flagged in the strip itself,
                  so a judge cannot mistake "I opened it" for "I read it". */}
              {!(s.rows ?? []).length && (
                <span title="No rows could be read from this sheet" aria-label=" (no rows read)">
                  {' '}
                  ⚠
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {/* An empty sheet used to render as a bare table with the footer
          reading "0 rows × 0 columns · more rows truncated", which tells a
          judge nothing about whether the sheet is genuinely empty or simply
          failed to parse. Either way they must not score it as if they had
          seen it. */}
      {!rows.length ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="font-display text-sm font-semibold text-ink">
            No rows could be read from the “{sheet.name}” sheet
          </p>
          <p className="max-w-md text-xs leading-relaxed text-ink-2">
            {unreadable
              ? 'The workbook parser failed on this sheet and could not recover any rows from it. The other sheets in this workbook are unaffected — but do not score this one as if you had read it.'
              : 'This sheet exists in the workbook but contains no data.'}
          </p>
          <a
            className="btn-secondary text-xs"
            href={api.deliverableUrl(deliverableId)}
            download
            aria-label={`Download ${filename} to open this sheet directly`}
          >
            Download the workbook
          </a>
        </div>
      ) : (
      <div
        className="ha-viewer-surface"
        role="document"
        tabIndex={0}
        aria-label={`${sheet.name || 'Worksheet'} of ${filename}. Use the arrow keys to scroll.`}
      >
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-elevated">
            {/* Frozen column-letter strip, above the sheet's own header row. */}
            <tr>
              <th className="w-8 border border-line bg-elevated px-1 py-0.5" />
              {Array.from({ length: width }).map((_, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border border-line bg-elevated px-2 py-0.5 text-center font-mono-arena text-[9px] font-normal text-ink-2"
                >
                  {columnLabel(i)}
                </th>
              ))}
            </tr>
            {header && (
              <tr>
                <th className="w-8 border border-line bg-elevated px-1 py-1" />
                {header.map((c, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="whitespace-nowrap border border-line bg-elevated px-2 py-1.5 text-left font-mono-arena font-semibold text-ink"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="hover:bg-elevated/60">
                <th
                  scope="row"
                  className="border border-line bg-floating px-1 py-1 text-center font-mono-arena text-[9px] font-normal text-ink-2"
                >
                  {r + 1}
                </th>
                {row.map((cell, c) => (
                  <td key={c} className="border border-line px-2 py-1 align-top text-ink-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <Footnote>
        {rows.length
          ? `${body.length} rows × ${width} columns · `
          : 'no rows read · '}
        sheet {active + 1} of {sheets.length}
        {/* Only meaningful when rows actually came back  -  on an empty sheet
            this flag means "parse stopped", which the panel above explains
            properly instead of implying there is more of something. */}
        {rows.length && sheet.truncated_rows ? ' · more rows truncated' : ''}
        {rows.length && sheet.truncated_cols ? ' · more columns truncated' : ''}
        {truncatedSheets ? ' · more sheets truncated' : ''}
      </Footnote>
    </div>
  )
}

/** The truncation banner  -  HA-VW-01, the report's only P0.
 *
 *  The preview endpoint caps long payloads at 60,000 characters and says so,
 *  returning a `truncated` boolean alongside the markup. The text, markdown
 *  and slides branches of the dispatch below all forward that flag, and the
 *  spreadsheet branch even prints "more rows truncated" in its footer  -  but
 *  the html and rich_html branches passed only the markup, and those are the
 *  two most likely to carry large files. The audited dashboard was cut to
 *  60,000 of 76,130 characters: 16,130 discarded (21.2%), ending mid
 *  table-cell, with the file's ONLY <script> block  -  the segment-filter
 *  logic its own UI advertises  -  inside the discarded tail. Judges were
 *  scoring an artifact that was a fifth missing and partly non-functional,
 *  and those scores feed a public leaderboard.
 *
 *  The client half of the fix is this banner. Raising or removing the cap is a
 *  server change and is tracked separately  -  see the note in README/HANDOFF. */
function TruncationBanner({ delivered, original, deliverableId, filename }) {
  const lostPct = original && delivered != null ? (((original - delivered) / original) * 100).toFixed(1) : null
  return (
    <div className="ha-banner" role="status" aria-live="polite">
      <strong className="font-semibold">Preview truncated.</strong>
      <span>
        {delivered != null && original
          ? `This inline preview shows the first ${delivered.toLocaleString()} of ${original.toLocaleString()} characters (${lostPct}% withheld), so later sections and any interactive behaviour are missing.`
          : 'This inline preview is incomplete, so later sections and any interactive behaviour are missing.'}
      </span>
      <a
        className="text-[12.5px] text-link"
        href={api.deliverableUrl(deliverableId)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open the complete ${filename} in a new tab`}
      >
        Open the complete file
      </a>
      <span>before scoring.</span>
    </div>
  )
}

// HA-VW-20: the frame carried sandbox="" with zero tokens, which withholds
// scripts and same-origin access TOGETHER. Granting allow-scripts without
// allow-same-origin is the combination that matters: the document keeps an
// opaque origin, so it can run its own code but can never reach this page,
// its storage or its cookies. Never add allow-same-origin alongside
// allow-scripts on same-origin content  -  a frame with both can remove its
// own sandbox attribute and escape entirely.
const HTML_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox'

// Second containment layer, inside the document rather than on the frame:
// no network of its own, no form submission, no base-uri games. Scripts and
// inline styles are allowed because that is the point of granting
// allow-scripts, and images are allowed so a dashboard's charts still draw.
const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="' +
  "default-src 'none'; img-src data: blob: https:; " +
  "style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
  "font-src data:; form-action 'none'; base-uri 'none'\">"

const WRAP_STYLE = `<style>
  body{font:14px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:28px 32px;max-width:80ch}
  h1,h2,h3,h4{font-family:Georgia,serif;line-height:1.25;margin:1.4em 0 .5em}
  h1{font-size:1.7em}h2{font-size:1.35em}h3{font-size:1.12em}
  p{margin:.7em 0}ul,ol{margin:.7em 0;padding-left:1.4em}li{margin:.25em 0}
  table{border-collapse:collapse;margin:1em 0;font-size:.9em;width:100%}
  th,td{border:1px solid #ccc;padding:6px 9px;text-align:left;vertical-align:top}
  th{background:#f3f3f3;font-weight:600}
  img{max-width:100%}
</style>`

function withCsp(markup, wrap) {
  const head = CSP_META + (wrap ? WRAP_STYLE : '')
  if (/<head[^>]*>/i.test(markup)) return markup.replace(/<head([^>]*)>/i, `<head$1>${head}`)
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${markup}</body></html>`
}

/** Agent-generated HTML (a docx conversion, or a dashboard the harness
 *  built). Contained in a sandboxed iframe on an opaque origin, so it can
 *  never touch the arena  -  see HTML_SANDBOX above for why one specific token
 *  combination is deliberately excluded. */
function SandboxedHtml({ preview, fullText, wrap, deliverableId, filename }) {
  // The complete file when we have it; the preview envelope's clipped copy
  // only as a fallback if the content fetch failed. The banner reflects what
  // is ACTUALLY on screen, which is why it reads from whichever source won.
  const html = fullText ? fullText.text : (preview.html ?? '')
  const truncated = fullText ? fullText.truncated : Boolean(preview.truncated)
  return (
    <>
      {truncated && (
        <TruncationBanner
          delivered={fullText ? fullText.delivered : html.length}
          original={fullText ? fullText.original : null}
          deliverableId={deliverableId}
          filename={filename}
        />
      )}
      <iframe
        title={`${filename} preview`}
        srcDoc={withCsp(html, wrap)}
        sandbox={HTML_SANDBOX}
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </>
  )
}

function DocxBody({ deliverableId, blobUrl, filename }) {
  const outerRef = useRef(null)
  const documentRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState(null)

  useEffect(() => {
    if (!blobUrl) return undefined
    let cancelled = false
    const controller = new AbortController()

    async function renderDocument() {
      setLoading(true)
      setError('')
      setScale(1)
      setHeight(null)
      try {
        // Reads the blob already cached for this deliverable rather than
        // going back to the network  -  HA-VW-08.
        const response = await fetch(blobUrl, { signal: controller.signal })
        if (!response.ok) throw new Error(`Could not load the document (${response.status}).`)
        const bytes = await response.arrayBuffer()
        if (cancelled || !documentRef.current) return

        documentRef.current.replaceChildren()
        await renderAsync(bytes, documentRef.current, undefined, {
          className: 'arena-docx',
          inWrapper: true,
          breakPages: true,
          useBase64URL: true,
          renderChanges: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        })
        if (!cancelled) setLoading(false)
      } catch (err) {
        if (err?.name === 'AbortError') return
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not render this Word document.')
          setLoading(false)
        }
      }
    }

    renderDocument()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [blobUrl])

  useEffect(() => {
    if (loading || !outerRef.current || !documentRef.current) return undefined

    function resize() {
      if (!outerRef.current || !documentRef.current) return
      const availableWidth = outerRef.current.clientWidth
      const documentWidth = documentRef.current.scrollWidth
      if (!documentWidth) return
      const nextScale = Math.min(1, availableWidth / documentWidth)
      setScale(nextScale)
      setHeight(documentRef.current.scrollHeight * nextScale)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(outerRef.current)
    return () => observer.disconnect()
  }, [loading])

  if (error) return <ViewerError error={new Error(error)} deliverableId={deliverableId} filename={filename} />

  return (
    <div
      ref={outerRef}
      className="ha-viewer-surface relative bg-floating"
      role="document"
      tabIndex={0}
      aria-label={`${filename} document. Use the arrow keys to scroll.`}
    >
      {loading && (
        <div className="absolute inset-0 z-10 overflow-hidden bg-floating">
          <ViewerSkeleton label="Rendering document…" />
        </div>
      )}
      <div style={{ height: height ?? 'auto' }}>
        <div
          ref={documentRef}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            width: scale < 1 ? `${100 / scale}%` : '100%',
          }}
          className="[&_.docx-wrapper]:flex [&_.docx-wrapper]:flex-col [&_.docx-wrapper]:items-center [&_.docx-wrapper]:gap-4 [&_.docx-wrapper]:p-4 [&_section]:bg-white [&_section]:shadow-md"
        />
      </div>
    </div>
  )
}

function PptxBody({ deliverableId, blobUrl, filename }) {
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!blobUrl) return undefined
    let cancelled = false
    let viewer = null
    const controller = new AbortController()

    async function render() {
      setLoading(true)
      setError('')
      try {
        // The original deck comes straight from our deliverable endpoint and
        // is parsed in this browser. It is never handed to Office or a
        // third-party conversion/viewer service.
        const response = await fetch(blobUrl, { signal: controller.signal })
        if (!response.ok) throw new Error(`Could not load the presentation (${response.status}).`)
        const bytes = await response.arrayBuffer()
        if (cancelled || !containerRef.current) return

        // Keep the fairly substantial rendering engine out of the normal
        // judging bundle; it is only useful when a PowerPoint tab is opened.
        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer')
        if (cancelled || !containerRef.current) return
        containerRef.current.replaceChildren()
        const renderedViewer = await PptxViewer.open(bytes, containerRef.current, {
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          lazySlides: true,
          lazyMedia: true,
          listOptions: {
            windowed: true,
            initialSlides: 4,
            batchSize: 4,
            overscanViewport: 1.5,
          },
          signal: controller.signal,
        })
        if (cancelled) {
          safeDestroy(renderedViewer)
          return
        }
        viewer = renderedViewer
        setLoading(false)
      } catch (err) {
        if (err?.name === 'AbortError') return
        if (isChunkLoadError(err) && reloadOnceForStaleChunk()) return
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not render the presentation.')
        if (!cancelled) setLoading(false)
      }
    }

    render()
    return () => {
      cancelled = true
      controller.abort()
      safeDestroy(viewer)
    }
  }, [blobUrl])

  if (error) return <ViewerError error={new Error(error)} deliverableId={deliverableId} filename={filename} />

  return (
    <div
      className="ha-viewer-surface relative bg-floating"
      role="document"
      tabIndex={0}
      aria-label={`${filename} presentation. Use the arrow keys to scroll.`}
    >
      {loading && (
        <div className="absolute inset-0 z-10 overflow-hidden bg-floating">
          <ViewerSkeleton label="Rendering presentation…" />
        </div>
      )}
      <div ref={containerRef} className="min-h-full p-4" />
    </div>
  )
}

function SlidesBody({ slides, totalSlides, truncated, filename }) {
  if (!slides?.length) return <Empty>No readable slides in this deck.</Empty>
  return (
    <div
      className="ha-viewer-surface bg-floating"
      role="document"
      tabIndex={0}
      aria-label={`${filename} slide text. Use the arrow keys to scroll.`}
    >
      <div className="mx-auto grid max-w-3xl gap-4 p-4">
        {slides.map((s) => (
          <div key={s.index} className="rounded-lg border border-line bg-surface p-5 shadow-sm">
            <p className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-2">
              Slide {s.index}
              {totalSlides ? ` of ${totalSlides}` : ''}
            </p>
            {s.title && <p className="font-display mt-2 text-lg font-semibold text-ink">{s.title}</p>}
            {s.lines.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-ink-2">
                {s.lines.map((ln, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-ink-3">•</span>
                    <span>{ln}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {truncated && <p className="text-center text-[11px] text-ink-2">More slides not shown. Download the full deck.</p>}
      </div>
    </div>
  )
}

/** Plain text  -  HA-VW-16.
 *
 *  The previous renderer was a single `white-space: pre` block with no wrap
 *  control. At 390px it measured 622px of content in a 326px window, forcing
 *  296px of horizontal scrolling on every line, which fails WCAG 1.4.10
 *  Reflow. Wrapping is the default now; the toggle restores `pre` for the
 *  column-aligned files where wrapping would destroy the layout, and line
 *  numbers make it possible to cite a spot in a score justification. */
// One <div> per line gives line numbers, but the DOM cost is linear in line
// count. Past this, the same content renders as a single <pre> instead: no
// numbers, but the whole file, and a page that still responds.
const MAX_NUMBERED_LINES = 30_000

function TextBody({ source, deliverableId, filename }) {
  const [wrap, setWrap] = useState(true)
  const text = source.text ?? ''
  const lines = text.split('\n')
  const numbered = lines.length <= MAX_NUMBERED_LINES
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {source.truncated && (
        <TruncationBanner
          delivered={source.delivered}
          original={source.original}
          deliverableId={deliverableId}
          filename={filename}
        />
      )}
      <div className="ha-viewer-toolbar">
        <button
          type="button"
          className={`ha-tool ${wrap ? 'ha-tool-active' : ''}`}
          onClick={() => setWrap((w) => !w)}
          aria-pressed={wrap}
        >
          Wrap lines
        </button>
        <span className="ha-tool-count">
          {lines.length.toLocaleString()} lines{numbered ? '' : ' · line numbers off at this size'}
        </span>
      </div>
      <div
        className="ha-viewer-surface"
        role="document"
        tabIndex={0}
        aria-label={`${filename}, plain text, ${lines.length} lines. Use the arrow keys to scroll.`}
      >
        <div className={`ha-code p-4 text-ink-2 ${wrap ? 'ha-code-wrapped' : ''}`}>
          {!numbered && <div className="ha-code-line">{text}</div>}
          {numbered &&
            lines.map((line, i) => (
            <div className="ha-code-row" key={i}>
              <span className="ha-code-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="ha-code-line">{line || ' '}</span>
            </div>
            ))}
        </div>
      </div>
    </div>
  )
}

// Inline `code`, [links](url), **bold**, *italic*/_italic_  -  tokenized with
// one regex pass so nesting doesn't need a real parser. Everything ends up
// as plain React children (never dangerouslySetInnerHTML), so an
// agent-produced file can't inject real markup this way, only text that
// happens to look bold/linked.
const MD_INLINE_RE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g

function renderInline(text) {
  const nodes = []
  let key = 0
  let lastIndex = 0
  let match
  MD_INLINE_RE.lastIndex = 0
  while ((match = MD_INLINE_RE.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    if (match[1] != null) {
      nodes.push(
        <code key={key++} className="rounded bg-elevated px-1 py-0.5 font-mono-arena text-[0.85em] text-ink">
          {match[1]}
        </code>
      )
    } else if (match[2] != null) {
      nodes.push(
        <a key={key++} href={match[3]} target="_blank" rel="noreferrer" className="text-link underline">
          {match[2]}
        </a>
      )
    } else if (match[4] != null) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          {match[4]}
        </strong>
      )
    } else {
      nodes.push(<em key={key++}>{match[5] ?? match[6]}</em>)
    }
    lastIndex = MD_INLINE_RE.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

const MD_HEADING_CLASS = {
  1: 'mt-4 mb-2 font-display text-2xl font-semibold text-ink',
  2: 'mt-4 mb-2 font-display text-xl font-semibold text-ink',
  3: 'mt-3 mb-1.5 text-lg font-semibold text-ink',
  4: 'mt-3 mb-1 text-base font-semibold text-ink',
  5: 'mt-2 mb-1 text-sm font-semibold text-ink',
  6: 'mt-2 mb-1 text-sm font-semibold text-ink-2',
}

/** Splits markdown text into block-level chunks (headings, lists, code
 *  fences, blockquotes, horizontal rules, paragraphs) with a line-by-line
 *  scan  -  covers the common subset an agent's write-up actually uses,
 *  without pulling in a markdown-parser dependency for it. */
function parseMarkdownBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }
    if (line.startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip the closing fence
      blocks.push({ type: 'code', content: codeLines.join('\n') })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: heading[2] })
      i++
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      const quoteLines = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', content: quoteLines.join(' ') })
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }
    const paraLines = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', content: paraLines.join(' ') })
  }
  return blocks
}

function MarkdownBody({ source, deliverableId, filename }) {
  const blocks = parseMarkdownBlocks(source.text ?? '')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {source.truncated && (
        <TruncationBanner
          delivered={source.delivered}
          original={source.original}
          deliverableId={deliverableId}
          filename={filename}
        />
      )}
      <div
        className="ha-viewer-surface"
        role="document"
        tabIndex={0}
        aria-label={`${filename} document text. Use the arrow keys to scroll.`}
      >
        <div className="mx-auto max-w-3xl p-4 text-[13px] leading-relaxed text-ink-2">
          {blocks.map((b, idx) => {
            if (b.type === 'heading') {
              return (
                <p key={idx} className={MD_HEADING_CLASS[b.level] ?? MD_HEADING_CLASS[6]}>
                  {renderInline(b.content)}
                </p>
              )
            }
            if (b.type === 'hr') return <hr key={idx} className="my-3 border-line" />
            if (b.type === 'quote') {
              return (
                <blockquote key={idx} className="my-2 border-l-2 border-line-strong pl-3 italic text-ink-2">
                  {renderInline(b.content)}
                </blockquote>
              )
            }
            if (b.type === 'ul') {
              return (
                <ul key={idx} className="my-2 list-disc space-y-1 pl-5">
                  {b.items.map((it, j) => (
                    <li key={j}>{renderInline(it)}</li>
                  ))}
                </ul>
              )
            }
            if (b.type === 'ol') {
              return (
                <ol key={idx} className="my-2 list-decimal space-y-1 pl-5">
                  {b.items.map((it, j) => (
                    <li key={j}>{renderInline(it)}</li>
                  ))}
                </ol>
              )
            }
            if (b.type === 'code') {
              return (
                <pre
                  key={idx}
                  className="my-2 overflow-x-auto rounded bg-elevated p-3 font-mono-arena text-[11px] leading-relaxed text-ink"
                >
                  <code>{b.content}</code>
                </pre>
              )
            }
            return (
              <p key={idx} className="my-2">
                {renderInline(b.content)}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Empty({ children }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-2">{children}</div>
}

function Footnote({ children }) {
  return (
    <p className="shrink-0 border-t border-line bg-floating px-3 py-1.5 font-mono-arena text-[11px] text-ink-2">
      {children}
    </p>
  )
}

/** Renderer choice, as a lookup on what the file actually is plus what the
 *  preview envelope says it contains. Every branch now lands in the same
 *  full-height chrome with the same keyboard contract  -  HA-VW-06/10. */
function Body({ preview, fullText, file, deliverableId, blobUrl, onToggleFullscreen, isFullscreen }) {
  const filename = file.filename
  const extension = fileExt(filename)

  if (extension === 'pdf') {
    return (
      <PdfBody
        deliverableId={deliverableId}
        blobUrl={blobUrl}
        filename={filename}
        onToggleFullscreen={onToggleFullscreen}
        isFullscreen={isFullscreen}
      />
    )
  }
  if (extension === 'docx') return <DocxBody deliverableId={deliverableId} blobUrl={blobUrl} filename={filename} />
  if (extension === 'pptx') return <PptxBody deliverableId={deliverableId} blobUrl={blobUrl} filename={filename} />

  if (!preview) return <Empty>No preview available.</Empty>

  // Prefer the complete file from the content endpoint; fall back to the
  // preview envelope's clipped copy only if that fetch failed. Either way the
  // renderer is handed one source that knows whether IT is truncated, so the
  // banner can never disagree with what is on screen.
  const textSource = fullText ?? {
    text: preview.text,
    truncated: Boolean(preview.truncated),
    delivered: null,
    original: null,
  }

  switch (preview.kind) {
    case 'sheets':
      return (
        <SheetBody
          sheets={preview.sheets}
          truncatedSheets={preview.truncated_sheets}
          degraded={preview.degraded}
          deliverableId={deliverableId}
          filename={filename}
        />
      )
    case 'rich_html':
      // A mammoth conversion of a .docx, not the raw file  -  so there is no
      // full-text equivalent to prefer here.
      return <SandboxedHtml preview={preview} wrap deliverableId={deliverableId} filename={filename} />
    case 'html':
      return (
        <SandboxedHtml preview={preview} fullText={fullText} deliverableId={deliverableId} filename={filename} />
      )
    case 'slides':
      return (
        <SlidesBody
          slides={preview.slides}
          totalSlides={preview.total_slides}
          truncated={preview.truncated}
          filename={filename}
        />
      )
    case 'text':
      return <TextBody source={textSource} deliverableId={deliverableId} filename={filename} />
    case 'markdown':
      return <MarkdownBody source={textSource} deliverableId={deliverableId} filename={filename} />
    default:
      return <Empty>{preview.reason || 'No inline preview for this file type.'}</Empty>
  }
}

/** Renders one deliverable file as the primary reading surface of the
 *  judging page.
 *
 *  HA-VW-02: this container used to be `h-[30rem]`  -  a hard 480px at every
 *  viewport, leaving a 417px reading window for 8,969px of PDF. 4.65% of the
 *  document was visible at once and reading one artifact took about 22
 *  screenfuls, which a judge then repeated for five deliverables across three
 *  anonymised outputs. The height comes from the viewport now (see
 *  `.ha-viewer` in theme.css); `--ha-chrome` lets the page that mounts it
 *  declare how much vertical space its own header takes. */
export default function FileViewer({ file, chrome = 240 }) {
  const rootRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const id = file?.id
  const ext = file ? fileExt(file.filename) : ''

  const { state, preview, blobUrl, fullText, progress, error, retry } = useArtifact(id, ext, warmRendererFor(ext))

  // HA-VW-17: there was no fullscreen control and no open-in-new-tab control
  // anywhere in the viewer chrome, so a reader who needed more space had no
  // escape hatch short of downloading the file.
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen?.()
    else el.requestFullscreen?.().catch(() => setIsFullscreen(false))
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useLayoutEffect(() => {
    rootRef.current?.style.setProperty('--ha-chrome', `${chrome}px`)
  }, [chrome])

  if (!file) return null

  const rawUrl = api.deliverableUrl(file.id)
  const sizeKb = ((file.size_bytes ?? 0) / 1024).toFixed(1)
  const titleId = `ha-viewer-title-${file.id}`
  const metaId = `ha-viewer-meta-${file.id}`

  return (
    <section
      ref={rootRef}
      className={`ha-viewer card ${isFullscreen ? 'ha-viewer-fullscreen' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={metaId}
    >
      {/* HA-VW-18: filename, type and size were three decorative spans with no
          programmatic relationship to the region they described. They are the
          viewer's accessible name now, and every terse control has a label
          that says which file it acts on. */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line bg-elevated px-3 py-2">
        <h3
          id={titleId}
          className="min-w-0 flex-1 basis-full truncate font-mono-arena text-[12px] font-normal text-ink sm:basis-auto"
          title={file.filename}
        >
          {file.filename}
        </h3>
        {/* This row was `shrink-0` and non-wrapping, so on a phone the last
            control  -  Fullscreen  -  was simply clipped by the card's own
            overflow: hidden. It wraps now, and the filename takes a full line
            of its own below the `sm` breakpoint so the controls get the width
            they need. */}
        <p id={metaId} className="ha-viewer-meta flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="uppercase">
            <span className="sr-only">File type: </span>
            {ext || 'file'}
          </span>
          <span>
            <span className="sr-only">File size: </span>
            {sizeKb} KB
          </span>
          <a
            href={rawUrl}
            className="text-[12px] text-link"
            download
            aria-label={`Download ${file.filename} (${sizeKb} KB)`}
          >
            Download
          </a>
          <a
            href={rawUrl}
            className="text-[12px] text-link"
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${file.filename} in a new tab`}
          >
            Open in new tab
          </a>
          <button
            type="button"
            className="ha-tool"
            onClick={toggleFullscreen}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : `View ${file.filename} fullscreen`}
          >
            {isFullscreen ? 'Exit' : 'Fullscreen'}
          </button>
        </p>
      </header>

      {/* Re-keyed per deliverable so one artifact's crash doesn't stick to the
          next one the judge opens. */}
      <ViewerErrorBoundary key={file.id} deliverableId={file.id} filename={file.filename}>
        {state === 'loading' && (
          <div className="ha-viewer-surface bg-floating">
            <ViewerSkeleton
              progress={progress}
              label={needsBytes(ext) ? 'Loading document…' : 'Loading preview…'}
            />
          </div>
        )}
        {state === 'error' && (
          <ViewerError error={error} deliverableId={file.id} filename={file.filename} onRetry={retry} />
        )}
        {state === 'ready' && (
          <Body
            preview={preview?.preview}
            fullText={fullText}
            file={file}
            deliverableId={file.id}
            blobUrl={blobUrl}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
          />
        )}
      </ViewerErrorBoundary>
    </section>
  )
}

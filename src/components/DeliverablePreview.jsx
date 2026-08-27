import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { LoadingState } from './ui.jsx'

// One-letter badge per file type, so a file row is scannable at a glance.
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
  md: 'T',
  json: 'J',
  py: 'Y',
}

function ext(filename) {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase()
}

function SheetView({ sheets, truncatedSheets }) {
  const [active, setActive] = useState(0)
  const sheet = sheets?.[active]
  if (!sheet) return <p className="p-3 text-xs text-ink-3">This workbook has no readable sheets.</p>

  // First row is treated as a header when it's fully populated  -  matches how
  // these evidence workbooks are actually laid out.
  const rows = sheet.rows ?? []
  const header = rows.length > 1 && rows[0].every((c) => c !== '') ? rows[0] : null
  const body = header ? rows.slice(1) : rows

  return (
    <div>
      {sheets.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-2.5">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-md px-3 py-1.5 font-mono-arena text-[13px] font-medium ${
                i === active ? 'bg-cta text-on-cta' : 'bg-elevated text-ink-2 hover:text-ink'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          {header && (
            <thead className="sticky top-0 bg-elevated">
              <tr>
                {header.map((c, i) => (
                  <th
                    key={i}
                    className="border border-line px-2 py-1 text-left font-mono-arena font-semibold text-ink"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="odd:bg-floating">
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
      {(sheet.truncated_rows || sheet.truncated_cols || truncatedSheets) && (
        <p className="border-t border-line px-3 py-2 text-[11px] text-ink-3">
          Preview truncated{sheet.truncated_rows ? ' (more rows)' : ''}
          {sheet.truncated_cols ? ' (more columns)' : ''}
          {truncatedSheets ? ' (more sheets)' : ''}. Download the full file.
        </p>
      )}
    </div>
  )
}

function DocumentView({ blocks, tables }) {
  return (
    <div className="max-h-[26rem] space-y-2 overflow-auto p-3 text-[12px] leading-relaxed">
      {blocks.map((b, i) =>
        b.type === 'heading' ? (
          <h4 key={i} className="font-display pt-2 text-sm font-semibold text-ink">
            {b.text}
          </h4>
        ) : (
          <p key={i} className="text-ink-2">
            {b.text}
          </p>
        )
      )}
      {tables?.map((t, ti) => (
        <table key={ti} className="w-full border-collapse text-[11px]">
          <tbody>
            {t.rows.map((row, r) => (
              <tr key={r} className="odd:bg-floating">
                {row.map((cell, c) => (
                  <td key={c} className="border border-line px-2 py-1 align-top text-ink-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {blocks.length === 0 && !tables?.length && <p className="text-xs text-ink-3">No readable text in this document.</p>}
    </div>
  )
}

function SlidesView({ slides, totalSlides, truncated }) {
  return (
    <div className="max-h-[26rem] space-y-3 overflow-auto p-3">
      {slides.map((s) => (
        <div key={s.index} className="rounded border border-line bg-floating p-3">
          <p className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
            Slide {s.index}
            {totalSlides ? ` / ${totalSlides}` : ''}
          </p>
          {s.title && <p className="font-display mt-1 text-sm font-semibold text-ink">{s.title}</p>}
          <ul className="mt-1 space-y-0.5 text-[12px] text-ink-2">
            {s.lines.map((ln, i) => (
              <li key={i}>· {ln}</li>
            ))}
          </ul>
        </div>
      ))}
          {truncated && <p className="text-[11px] text-ink-3">More slides not shown. Download the full deck.</p>}
    </div>
  )
}

function PagesView({ pages, totalPages, truncated }) {
  return (
    <div className="max-h-[26rem] space-y-3 overflow-auto p-3">
      {pages.map((p) => (
        <div key={p.index}>
          <p className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
            Page {p.index} / {totalPages}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">
        {p.text || <span className="italic text-ink-3">(no extractable text. This may be an image-only page.)</span>}
          </p>
        </div>
      ))}
      {truncated && <p className="text-[11px] text-ink-3">More pages not shown. Download the full document.</p>}
    </div>
  )
}

function HtmlView({ html, deliverableId }) {
  const [raw, setRaw] = useState(false)
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button
          type="button"
          onClick={() => setRaw((r) => !r)}
          className="font-mono-arena text-[11px] text-link"
        >
          {raw ? 'show rendered' : 'show source'}
        </button>
      </div>
      {raw ? (
        <pre className="max-h-[26rem] overflow-auto p-3 text-[11px] text-ink-2">{html}</pre>
      ) : (
        // Sandboxed with no allow-* flags: the dashboard is agent-generated
        // HTML, so it renders without scripts, same-origin access, forms, or
        // navigation. srcDoc keeps it off this origin entirely.
        <iframe
          title="Deliverable preview"
          srcDoc={html}
          sandbox=""
          className="h-[26rem] w-full border-0 bg-white"
        />
      )}
    </div>
  )
}

function TextView({ text, truncated }) {
  return (
    <div>
      <pre className="max-h-[26rem] overflow-auto p-3 text-[11px] leading-relaxed text-ink-2">{text}</pre>
      {truncated && <p className="border-t border-line px-3 py-2 text-[11px] text-ink-3">Preview truncated.</p>}
    </div>
  )
}

function PreviewBody({ data, deliverableId }) {
  const p = data?.preview
  if (!p) return <LoadingState compact label="Loading preview…" className="p-3 text-xs" />

  switch (p.kind) {
    case 'sheets':
      return <SheetView sheets={p.sheets} truncatedSheets={p.truncated_sheets} />
    case 'document':
      return <DocumentView blocks={p.blocks} tables={p.tables} />
    case 'slides':
      return <SlidesView slides={p.slides} totalSlides={p.total_slides} truncated={p.truncated} />
    case 'pages':
      return <PagesView pages={p.pages} totalPages={p.total_pages} truncated={p.truncated} />
    case 'html':
      return <HtmlView html={p.html} deliverableId={deliverableId} />
    case 'text':
      return <TextView text={p.text} truncated={p.truncated} />
    default:
      return <p className="p-3 text-xs text-ink-3">{p.reason || 'No inline preview available.'}</p>
  }
}

export default function DeliverablePreview({ deliverables }) {
  const [activeId, setActiveId] = useState(deliverables?.[0]?.id ?? null)
  const [cache, setCache] = useState({})
  const [error, setError] = useState('')

  // Keep the selection valid when the file list changes (e.g. Regenerate).
  useEffect(() => {
    if (!deliverables?.length) {
      setActiveId(null)
      return
    }
    if (!deliverables.some((d) => d.id === activeId)) setActiveId(deliverables[0].id)
  }, [deliverables, activeId])

  useEffect(() => {
    if (activeId == null || cache[activeId]) return
    let cancelled = false
    setError('')
    api
      .deliverablePreview(activeId)
      .then((data) => {
        if (!cancelled) setCache((prev) => ({ ...prev, [activeId]: data }))
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [activeId, cache])

  if (!deliverables?.length) {
    return <p className="text-sm italic text-ink-3">This output produced no deliverable files.</p>
  }

  const active = deliverables.find((d) => d.id === activeId)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {deliverables.map((d) => {
          const e = ext(d.filename)
          const on = d.id === activeId
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveId(d.id)}
              title={d.filename}
              className={`flex max-w-full items-center gap-1.5 rounded border px-2 py-1 font-mono-arena text-[11px] ${
                on ? 'border-line-strong bg-elevated text-ink' : 'border-line bg-floating text-ink-2 hover:text-ink'
              }`}
            >
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-line-strong text-[9px] font-semibold text-ink"
                aria-hidden="true"
              >
                {TYPE_BADGE[e] ?? '·'}
              </span>
              <span className="truncate">{d.filename}</span>
            </button>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-elevated px-3 py-2">
          <span className="min-w-0 truncate font-mono-arena text-[11px] text-ink">{active?.filename}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="font-mono-arena text-[10px] text-ink-3">
              {((active?.size_bytes ?? 0) / 1024).toFixed(1)} KB
            </span>
            {active && (
              <a href={api.deliverableUrl(active.id)} className="text-[11px] text-link" download>
                download
              </a>
            )}
          </span>
        </div>
        {error ? (
          <p className="p-3 text-xs text-bad">{error}</p>
        ) : (
          <PreviewBody data={cache[activeId]} deliverableId={activeId} />
        )}
      </div>
    </div>
  )
}

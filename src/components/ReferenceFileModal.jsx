import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.js'

export default function ReferenceFileModal({ taskId, file, onClose }) {
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    setContent('')
    setError('')
    setLoading(true)
    api.getReferenceFileContent(taskId, file.id).then((value) => { setContent(value); setLoading(false) }).catch((err) => { setError(err.message); setLoading(false) })
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [file.id, onClose, taskId])

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4">
      {/* `fixed`, not `absolute` — see ModelPickerModal's identical backdrop
          for why: `absolute` here only covers one viewport-height, not the
          full scrollable dialog. */}
      <button type="button" className="fixed inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm" aria-label="Close reference file" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-start justify-center py-6 sm:items-center">
        <section role="dialog" aria-modal="true" aria-labelledby="reference-file-title" className="card w-full max-w-4xl p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow">Reference file</p>
              <h2 id="reference-file-title" className="mt-1 truncate font-display text-xl font-semibold">{file.filename}</h2>
            </div>
            <button type="button" className="btn-secondary shrink-0 px-3 py-1.5" aria-label="Close reference file" onClick={onClose}>×</button>
          </div>
          {error ? (
            <p className="mt-5 text-sm text-bad">{error}</p>
          ) : loading ? (
            <div className="mt-5"><span className="text-sm text-ink-3">Loading file…</span></div>
          ) : (
            <pre className="mt-5 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-floating p-4 font-mono-arena text-xs leading-relaxed text-ink-2">{content || 'File is empty.'}</pre>
          )}
        </section>
      </div>
    </div>,
    document.body
  )
}

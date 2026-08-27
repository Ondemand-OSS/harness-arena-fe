import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.js'

const TERMINAL_STATUSES = new Set(['done', 'error', 'stopped'])
const POLL_INTERVAL_MS = 1500
const SIGN_IN_REQUIRED_MESSAGE = 'Sign in required to see the logs. Please log in.'

function isSignInRequired(error) {
  return error?.status === 401 || /sign in|required|unauthori[sz]ed|not authenticated|session expired/i.test(error?.message ?? '')
}

function statusLabel(status) {
  if (status === 'pending') return 'Queued'
  if (status === 'running') return 'Running'
  if (status === 'done') return 'Done'
  if (status === 'stopped') return 'Stopped'
  if (status === 'error') return 'Error'
  return status ?? 'Unknown'
}

function statusClass(status) {
  if (status === 'running') return 'text-warn'
  if (status === 'done') return 'text-good'
  if (status === 'error' || status === 'stopped') return 'text-bad'
  return 'text-ink-3'
}

function mapLogData(data) {
  return {
    status: data.status ?? 'running',
    raw_log: data.raw_log ?? '',
    deliverables_done: data.deliverables_done ?? 0,
    deliverables_expected: data.deliverables_expected ?? 0,
    error_message: data.error_message ?? '',
  }
}

function pollRunLog(runId, onUpdate, onError, intervalMs = POLL_INTERVAL_MS) {
  let cancelled = false
  let timer = null

  async function tick() {
    if (cancelled) return
    try {
      const data = await api.runLog(runId)
      onUpdate(mapLogData(data))
      if (TERMINAL_STATUSES.has(data.status)) return
    } catch (error) {
      if (onError?.(error)) return
      // transient network error — try again next tick
    }
    if (!cancelled) timer = window.setTimeout(tick, intervalMs)
  }

  tick()

  return () => {
    cancelled = true
    if (timer) window.clearTimeout(timer)
  }
}

export default function RunLogStreamModal({ runId, harnessName, onClose }) {
  const [stream, setStream] = useState({
    status: 'pending',
    raw_log: '',
    deliverables_done: 0,
    deliverables_expected: 0,
    error_message: '',
  })
  const [connected, setConnected] = useState(false)
  const [signInRequired, setSignInRequired] = useState(false)
  const logRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    setSignInRequired(false)
    setConnected(true)
    return pollRunLog(runId, (next) => {
      setStream(next)
      if (TERMINAL_STATUSES.has(next.status)) setConnected(false)
    }, (error) => {
      if (!isSignInRequired(error)) return false
      setConnected(false)
      setSignInRequired(true)
      return true
    })
  }, [runId])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [stream.raw_log])

  const live = stream.status === 'pending' || stream.status === 'running'

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4">
      <button type="button" className="fixed inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm" aria-label="Close run logs" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-start justify-center py-6 sm:items-center">
        <section role="dialog" aria-modal="true" aria-labelledby="run-log-title" className="card flex w-full max-w-4xl flex-col p-5 shadow-2xl sm:max-h-[85vh] sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow">Run logs</p>
              <h2 id="run-log-title" className="mt-1 truncate font-display text-xl font-semibold">{harnessName}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className={`font-mono-arena uppercase tracking-wider ${statusClass(stream.status)}`}>{statusLabel(stream.status)}</span>
                {live && connected && (
                  <span className="font-mono-arena uppercase tracking-wider text-ink-3">
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warn" aria-hidden="true" />
                    Live
                  </span>
                )}
                {stream.deliverables_expected > 0 && (
                  <span className="text-ink-3">
                    {stream.deliverables_done}/{stream.deliverables_expected} deliverables
                  </span>
                )}
              </div>
            </div>
            <button type="button" className="btn-secondary shrink-0 px-3 py-1.5" aria-label="Close run logs" onClick={onClose}>
              ×
            </button>
          </div>

          {signInRequired ? (
            <p className="mt-4 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm font-medium text-warn" role="alert">
              {SIGN_IN_REQUIRED_MESSAGE}
            </p>
          ) : stream.error_message && (
            <p className="mt-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 font-mono-arena text-xs text-bad">{stream.error_message}</p>
          )}

          {!signInRequired && (
            <pre
              ref={logRef}
              className="mt-4 min-h-[12rem] flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-[#0d1117] p-4 font-mono-arena text-xs leading-relaxed text-[#c9d1d9] sm:max-h-[60vh]"
            >
              {stream.raw_log || (live ? 'Waiting for output…' : 'No log output.')}
            </pre>
          )}
        </section>
      </div>
    </div>,
    document.body
  )
}

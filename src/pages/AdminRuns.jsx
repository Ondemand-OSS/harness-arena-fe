import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { EmptyState, FilterPills, HarnessAvatar, LoadingState, ModelBadge, PageHeader } from '../components/ui.jsx'

const STATUS_FILTERS = ['pending', 'running', 'done', 'error']
const STATUS_LABEL = {
  pending: 'Queued',
  running: 'Running',
  done: 'Done',
  error: 'Failed',
}
const STATUS_TONE = {
  pending: 'text-ink-3',
  running: 'text-warn',
  done: 'text-good',
  error: 'text-bad',
}

// Fast enough to feel live while an admin is actually watching a run
// happen, without hammering the backend when nothing's changing.
const POLL_MS = 5000

function roundLabel(roundId) {
  if (roundId == null) return ''
  return typeof roundId === 'string' ? roundId.slice(0, 8) : `legacy-${roundId}`
}

function RunLog({ run }) {
  if (!run.raw_log) return <p className="px-4 pb-3 text-xs text-ink-3">No log captured for this run.</p>
  return (
    <pre className="mx-4 mb-3 max-h-64 overflow-auto rounded-lg border border-line bg-floating p-3 font-mono-arena text-[11px] leading-relaxed text-ink-2 whitespace-pre-wrap">
      {run.raw_log}
    </pre>
  )
}

function RunRow({ run, onRetry, busy }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-elevated"
        aria-expanded={open}
      >
        <span className="font-mono-arena text-xs text-ink-3">#{run.id}</span>
        {run.round_id != null && (
          <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 font-mono-arena text-[10px] text-ink-3" title={`Battle round UUID: ${run.round_id}`}>
            round {roundLabel(run.round_id)}
          </span>
        )}
        <span className={`shrink-0 font-mono-arena text-[10px] uppercase tracking-wider ${STATUS_TONE[run.status] ?? 'text-ink-3'}`}>
          {STATUS_LABEL[run.status] ?? run.status}
        </span>
        {run.retry_count > 0 && (
          <span
            className="shrink-0 rounded bg-warn/15 px-1.5 py-0.5 font-mono-arena text-[10px] text-warn"
            title={`Failed and was retried ${run.retry_count} time${run.retry_count === 1 ? '' : 's'} to reach this status  -  it didn't succeed on the first attempt.`}
          >
            retried ×{run.retry_count}
          </span>
        )}
        <HarnessAvatar harnessKey={run.harness_key} name={run.harness_key} size={20} />
        <span className="shrink-0 text-sm font-medium">{run.harness_key}</span>
        <ModelBadge model={run.model} />
        <Link
          to={`/eval/${run.task_id}`}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate text-sm text-link hover:underline"
        >
          {run.task_title}
        </Link>
        {run.status === 'running' && run.deliverables_expected > 0 && (
          <span className="shrink-0 font-mono-arena text-[11px] text-warn">
            {run.deliverables_done}/{run.deliverables_expected} deliverables
          </span>
        )}
        {run.status === 'done' && run.deliverables_expected > 0 && run.deliverables_done === 0 && (
          <span
            className="shrink-0 rounded bg-bad/15 px-1.5 py-0.5 font-mono-arena text-[10px] text-bad"
            title="The agent reported this run as successful, but no deliverable files were produced."
          >
            no deliverable
          </span>
        )}
        {run.submitted_by && <span className="shrink-0 text-xs text-ink-3">by {run.submitted_by}</span>}
      </button>

      {open && (
        <div className="border-t border-line">
          {run.round_id != null && (
            <p className="break-all px-4 pt-3 font-mono-arena text-[11px] text-ink-3">Battle round UUID: {run.round_id}</p>
          )}
          {run.ondemand_session_ids?.length > 0 ? (
            <div className="px-4 pt-3 font-mono-arena text-[11px] text-ink-3">
              <p>OnDemand sessions ({run.ondemand_session_ids.length})</p>
              <ul className="mt-1 space-y-1 break-all">
                {run.ondemand_session_ids.map((sessionId) => <li key={sessionId}>{sessionId}</li>)}
              </ul>
            </div>
          ) : run.ondemand_session_id && (
            <p className="px-4 pt-3 font-mono-arena text-[11px] text-ink-3">OnDemand session: {run.ondemand_session_id}</p>
          )}
          {run.status === 'error' && run.error_message && (
            <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-bad" title={run.error_message}>
                {run.error_message}
              </span>
              <button type="button" className="shrink-0 text-link hover:underline disabled:opacity-50" disabled={busy} onClick={() => onRetry(run.id)}>
                {busy ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
          {run.previous_error_message && (
            <p className="px-4 py-2 text-xs text-warn">
              Previous failure before retry: <span className="break-words text-ink-2">{run.previous_error_message}</span>
            </p>
          )}
          <RunLog run={run} />
        </div>
      )}
    </div>
  )
}

export default function AdminRuns() {
  const { user, isAdminMode } = useAuth()
  const [statusFilter, setStatusFilter] = useState('')
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyRunIds, setBusyRunIds] = useState(() => new Set())

  function setRunBusy(runId, isBusy) {
    setBusyRunIds((current) => {
      const next = new Set(current)
      if (isBusy) next.add(runId)
      else next.delete(runId)
      return next
    })
  }

  const load = useCallback(async () => {
    return api.adminListRuns({ status: statusFilter || undefined, limit: 200 })
  }, [statusFilter])

  useEffect(() => {
    if (!isAdminMode) return undefined
    let cancelled = false
    setLoading(true)
    load()
      .then((list) => {
        if (!cancelled) {
          setRuns(list)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [load, isAdminMode])

  // Only poll while something is actually in flight  -  an all-settled
  // history doesn't need to be re-fetched every 5s.
  const anyInFlight = runs.some((r) => r.status === 'pending' || r.status === 'running')
  useEffect(() => {
    if (!isAdminMode || !anyInFlight) return undefined
    let cancelled = false
    const timer = setInterval(() => {
      load()
        .then((list) => {
          if (!cancelled) setRuns(list)
        })
        .catch(() => {})
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [load, isAdminMode, anyInFlight])

  async function retry(runId) {
    setRunBusy(runId, true)
    setError('')
    try {
      await api.retryRun(runId)
      setRuns(await load())
    } catch (err) {
      setError(err.message)
    } finally {
      setRunBusy(runId, false)
    }
  }

  if (!user?.is_admin) {
    return <EmptyState>Admin only.</EmptyState>
  }
  if (!isAdminMode) {
    return <EmptyState>Switch to Admin mode (top bar) to see every run across the arena.</EmptyState>
  }

  const counts = {
    pending: runs.filter((r) => r.status === 'pending').length,
    running: runs.filter((r) => r.status === 'running').length,
    done: runs.filter((r) => r.status === 'done').length,
    error: runs.filter((r) => r.status === 'error').length,
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin" title="Runs">
        <p>
          Every harness run across the whole arena  -  not scoped to one task. Watch what's queued, what's running
          right now, and read a truncated log excerpt for anything that finished or failed, without needing database
          access.
        </p>
      </PageHeader>

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm text-ink-2">
        <span>
          <span className="font-mono-arena font-semibold text-ink">{counts.pending}</span> queued
        </span>
        <span>
          <span className="font-mono-arena font-semibold text-warn">{counts.running}</span> running
        </span>
        <span>
          <span className="font-mono-arena font-semibold text-good">{counts.done}</span> done
        </span>
        <span>
          <span className="font-mono-arena font-semibold text-bad">{counts.error}</span> failed
        </span>
      </div>

      <FilterPills
        options={STATUS_FILTERS.map((s) => STATUS_LABEL[s])}
        value={STATUS_LABEL[statusFilter] ?? ''}
        onChange={(label) => setStatusFilter(STATUS_FILTERS.find((s) => STATUS_LABEL[s] === label) ?? '')}
      />

      {error && <p className="text-sm text-bad">{error}</p>}

      {loading ? (
        <LoadingState label="Loading runs…" />
      ) : runs.length === 0 ? (
        <EmptyState>No runs match this filter.</EmptyState>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} onRetry={retry} busy={busyRunIds.has(run.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

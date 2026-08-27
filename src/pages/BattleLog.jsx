import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import {
  EmptyState,
  HarnessAvatar,
  IdentityStrip,
  LoadingState,
  ModelBadge,
  PageHeader,
  Pagination,
  RateBar,
  SlotBadge,
  Tag,
  identityColor,
} from '../components/ui.jsx'
import { IconBrowser, IconChevron, IconCode } from '../components/icons.jsx'
import ChoiceDropdown from '../components/ChoiceDropdown.jsx'
import RunLogStreamModal from '../components/RunLogStreamModal.jsx'
import { isWebProjectTask } from '../lib/webProject.js'
import { useAdjacentPagePrefetch } from '../lib/useAdjacentPagePrefetch.js'

const STATUS_FILTERS = ['Queued', 'In progress', 'Partially failed', 'Failed', 'Insufficient results to judge', 'Judged', 'Awaiting your judgement', 'Awaiting community & your judgement']
const OUTCOME_FILTERS = ['Decisive', 'Tie']
const INSUFFICIENT_RESULTS_MESSAGE = 'Not enough results to judge. Please retry failed ones or try again later.'

function InsufficientResultsToast({ onClose }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [onClose])

  return createPortal(
    <div role="alert" className="fixed bottom-5 left-1/2 z-[110] flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-warn/30 bg-floating px-4 py-3 text-sm font-medium text-warn shadow-xl">
      <span className="text-base" aria-hidden="true">⚠</span>
      <span className="min-w-0 flex-1">{INSUFFICIENT_RESULTS_MESSAGE}</span>
      <button type="button" className="text-ink-3 hover:text-ink" onClick={onClose} aria-label="Dismiss">×</button>
    </div>,
    document.body
  )
}

function roundLabel(roundId) {
  if (roundId == null) return ''
  // New ids are UUIDs. Historical counter values remain readable but are no
  // longer presented as public sequential battle numbers.
  return typeof roundId === 'string' ? roundId.slice(0, 8) : `legacy-${roundId}`
}

// Custom categories remain in the broad Other lane until an admin maps them
// to an approved group. Keep the filter and task tag aligned with that rule.
function categoryLabel(task) {
  return task?.group === 'Other' ? 'Other' : task?.category
}

function latestRunTime(runs) {
  return Math.max(
    0,
    ...(runs ?? []).map((run) => {
      const timestamp = run.finished_at || run.started_at
      const value = timestamp ? new Date(timestamp).getTime() : 0
      return Number.isFinite(value) ? value : 0
    })
  )
}

// "5m ago" -> "3h ago" -> "2d ago"  -  minutes for the first hour, then hours
// for the first day, then days from there. Recomputed on every render
// rather than kept live-ticking; good enough for a value that only matters
// to the nearest bucket.
function timeAgo(ms) {
  if (!ms) return null
  const diffMs = Date.now() - ms
  if (diffMs < 0) return null
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** A harness's community rating as small filled/empty stars (rounded to the
 *  nearest of 5) plus the vote count  -  swapped in for the old cramped
 *  "★ 7.5 (4)" text badge, which read like a stray fragment next to the
 *  harness name rather than an actual rating. `ml-auto` pins it to the
 *  right side of whatever row it's in, away from the name/score cluster. */
function StarRating({ score, votes, pushRight = false }) {
  if (!votes) return null
  const filled = Math.round((score / 10) * 5)
  return (
    <span
      className={`flex shrink-0 items-center gap-1 ${pushRight ? 'ml-auto' : ''}`}
      title={`Community rating: ${score}/10 average across ${votes} vote${votes === 1 ? '' : 's'}`}
    >
      <span className="flex text-[11px] leading-none tracking-tight">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={i < filled ? 'text-warn' : 'text-ink-3/40'}>
            ★
          </span>
        ))}
      </span>
      <span className="font-mono-arena text-[10px] text-ink-3">({votes})</span>
    </span>
  )
}

// This section polls in the background for anyone who happens to have the
// page open, not someone actively watching a submission they just made
// (Benchmark.jsx polls its own batch much faster for that case)  -  so this
// stays a low-frequency check rather than something that adds real load.
const BACKGROUND_POLL_MS = 20_000
const BATTLES_PER_PAGE = 6

const BATCH_TASK_LABEL = {
  queued: 'Queued',
  running: 'Running…',
  ready: 'Ready to grade',
  judged: 'Judged by you',
}
const BATCH_TASK_TONE = {
  queued: 'text-ink-3',
  running: 'text-warn',
  ready: 'text-good',
  judged: 'text-ink-3',
}

/** Benchmarks currently being run: agents work through tasks one at a
 *  time, and a finished task's deliverables are ready to grade immediately
 *   -  no need to wait for the rest of the batch. */
function RunningBenchmarks() {
  const [batches, setBatches] = useState([])

  useEffect(() => {
    let cancelled = false
    let timer
    function poll() {
      api
        .listBatches(true)
        .then((list) => {
          if (cancelled) return
          setBatches(list)
          timer = setTimeout(poll, BACKGROUND_POLL_MS)
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, BACKGROUND_POLL_MS)
        })
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  if (batches.length === 0) return null

  return (
    <div className="space-y-3">
      <p className="eyebrow">Running now</p>
      {batches.map((b) => {
        // Queued/running tasks are just noise to list one by one here  -
        // there's nothing to do about any of them individually, only a
        // count of how many are still working. A "ready" task IS
        // actionable (there's a real Grade now link for it), so those
        // stay listed; only the not-yet-actionable ones collapse to a
        // number.
        const inProgress = b.tasks.filter((t) => t.state === 'queued' || t.state === 'running').length
        const ready = b.tasks.filter((t) => t.state === 'ready')
        const judged = b.tasks.filter((t) => t.state === 'judged').length
        const currentTask = b.tasks.find((t) => t.task_id === b.current_task_id)
        return (
          <div key={b.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-2">
                Benchmark #{b.id}
                {inProgress > 0 && ` · ${inProgress} task${inProgress === 1 ? '' : 's'} in progress`}
                {judged > 0 && ` · ${judged} judged by you`}
              </p>
              {b.current_task_id && (
                <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-warn/25 bg-warn/10 px-3 py-1.5 font-mono-arena text-[10px] font-semibold uppercase tracking-wider text-warn">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warn" aria-hidden="true" />
                  <span className="shrink-0">Running Current Task</span>
                  {currentTask?.title && <span className="min-w-0 truncate border-l border-warn/25 pl-2 normal-case font-normal tracking-normal text-ink-2" title={currentTask.title}>{currentTask.title}</span>}
                </span>
              )}
            </div>
            {ready.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {ready.map((t) => (
                  <div key={t.task_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{t.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`font-mono-arena text-xs ${BATCH_TASK_TONE[t.state]}`}>
                        {BATCH_TASK_LABEL[t.state]}
                      </span>
                      <Link
                        to={`/eval/${t.task_id}${b.provider_config_id ? `?model=${b.provider_config_id}` : ''}`}
                        state={{ from: '/battles' }}
                        className="btn-cta px-2.5 py-1 text-xs"
                      >
                        Grade now
                      </Link>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Once a harness has ever produced a successful result for this task,
 *  that success stays visible here even if a later Regenerate/retry on
 *  that same harness failed  -  a new failure (shown separately, in Failed
 *  below) doesn't erase a prior win. `compare()` itself already resolves
 *  the same way server-side (it finds the latest *done* run per harness,
 *  independent of whatever a newer, different-status run is), so this
 *  keeps the display in sync with what compare()'s entries actually are.
 *  Returns one run per harness_key: the current one if it's done,
 *  otherwise the most recent done run from history. */
function everDoneByHarness(runs, history) {
  const byHarness = new Map()
  for (const run of runs ?? []) {
    if (run.status === 'done') byHarness.set(run.harness_key, run)
  }
  for (const run of history ?? []) {
    if (run.status !== 'done' || byHarness.has(run.harness_key)) continue
    const existing = byHarness.get(run.harness_key)
    if (!existing || run.id > existing.id) byHarness.set(run.harness_key, run)
  }
  return byHarness
}

/** Every done run that isn't already shown in `entries` above (see
 *  `promotedIds`, the resolved comparison's own run ids)  -  every OTHER
 *  earlier Regenerate, every other model that was tried and superseded.
 *  Deliberately NOT "every run that isn't the current one for its
 *  harness": a harness's own most-recent run can be done and still not be
 *  part of the CURRENTLY DISPLAYED comparison  -  e.g. OnDemand's latest
 *  run sitting on an older profile while Claude Code/Codex moved on to a
 *  newer one (see runs.py's _resolve_ever_done_provider_config_id)  -  and
 *  that run needs somewhere to show up, or it vanishes from the row
 *  entirely (neither the live comparison nor a past attempt).
 *
 *  Grouped by round_id  -  one battle trigger, whether it ran one harness or
 *  several  -  not one entry per individual run. Runs from before round_id
 *  existed (see runner.py's run_task) each stand alone as their own round
 *  of one rather than merging with anything else. Carries the full run
 *  shape (deliverables, submitted_by, provider_config_id  -  not just
 *  harness/model) so a past round can be rendered as an ordinary BattleRow
 *  card (see buildRows below), not a stripped-down summary: it IS an
 *  ordinary round, just one that already finished, not something that
 *  needs its own simplified presentation. */
function pastAttempts(runs, history, promotedIds, harnessesByKey) {
  const candidates = (history ?? []).filter((r) => !promotedIds.has(r.id) && r.status === 'done')
  const byRound = new Map()
  for (const r of candidates) {
    const key = r.round_id ?? `run-${r.id}`
    if (!byRound.has(key)) byRound.set(key, { round_id: r.round_id ?? null, runs: [] })
    byRound.get(key).runs.push(r)
  }
  return [...byRound.entries()]
    .map(([key, group]) => {
      const sortedRuns = [...group.runs].sort((a, b) => a.id - b.id)
      return {
        key,
        round_id: group.round_id,
        run_ids: sortedRuns.map((r) => r.id),
        latestRunId: sortedRuns[sortedRuns.length - 1].id,
        providerConfigId: sortedRuns[0]?.provider_config_id ?? null,
        harnesses: sortedRuns.map((r) => ({
          run_id: r.id,
          round_id: r.round_id,
          harness_key: r.harness_key,
          harness_name: harnessesByKey[r.harness_key]?.name ?? r.harness_key,
          model: r.model,
          deliverables: r.deliverables,
          deliverables_done: r.deliverables_done ?? r.deliverables.length,
          deliverables_expected: r.deliverables_expected ?? 0,
          submitted_by: r.submitted_by,
          already_scored: r.already_scored,
          community_avg_score: r.community_avg_score,
          community_vote_count: r.community_vote_count,
        })),
        when: sortedRuns.reduce((latest, r) => {
          const t = r.finished_at || r.started_at
          return t && (!latest || new Date(t) > new Date(latest)) ? t : latest
        }, null),
      }
    })
    .sort((a, b) => b.latestRunId - a.latestRunId)
}

/** One task can produce up to TWO cards here, but only when there's an
 *  actual conflict worth keeping apart:
 *  - "historical": the best-ever, frozen comparison per harness (survives
 *    a later failure on any one harness  -  see everDoneByHarness)  -  once
 *    judged, its scores never move just because someone regenerated one
 *    harness afterward.
 *  - "latest": whatever's currently active or currently failed for a
 *    harness whose OWN prior success is what's in the historical card  -  a
 *    fresh attempt in progress or a fresh failure on top of an old win.
 *    Never mixed into the historical card's own numbers, so an old 8/10
 *    comparison never gets a "2 failed" tacked onto it.
 *  When every "done" entry IS a harness's current run (nothing stale, no
 *  harness switched from a past win to a present failure), there's no old
 *  comparison to protect  -  a done harness and a failed harness are just two
 *  results from the SAME round, and belong in one card together (see
 *  hasStaleComparison below). Either card can be absent; a task with
 *  nothing done yet AND nothing active/failed gets a single, plain
 *  "Not run" card instead. */
/** One shared status computation for every kind of row buildRows produces
 *  (historical, current, and standalone past-round cards)  -  judging needs
 *  at least two done harnesses to compare (see routers/scores.py's
 *  submit_scores, which now rejects a submission covering fewer than
 *  two); a round stuck at exactly one done harness  -  whether because the
 *  others simply weren't run, or because they failed  -  gets a distinct
 *  "Insufficient results to judge" instead of implying judging is
 *  available. Once a retry succeeds and doneCount reaches 2+, this falls
 *  straight back through to the normal judged/awaiting/partially-failed
 *  states  -  nothing else has to change for that to happen. */
function resolveRowStatus({ running, queued, retrying, doneCount, hasFailed, judged, notJudgedByViewerStatus }) {
  if (retrying && (running || queued)) return 'Retrying failed runs'
  if (running) return 'In progress'
  if (queued) return 'Queued'
  if (doneCount === 0) return hasFailed ? 'Failed' : 'Not run'
  if (doneCount === 1) return 'Insufficient results to judge'
  if (hasFailed) return 'Partially failed'
  return judged ? 'Judged' : notJudgedByViewerStatus
}

function buildLegacyRows(task, runs, history, compare, harnessesByKey) {
  const activeRuns = (runs ?? []).filter((r) => r.status === 'pending' || r.status === 'running')
  const queuedRuns = activeRuns.filter((run) => run.status === 'pending')
  const runningRuns = activeRuns.filter((run) => run.status === 'running')
  const failedRuns = (runs ?? []).filter((r) => r.status === 'error')
  const inFlight = activeRuns.length > 0
  const retrying = activeRuns.some((run) => run.is_retrying)
  const judged = Boolean(compare?.revealed)

  const doneByHarness = everDoneByHarness(runs, history)
  const doneRuns = [...doneByHarness.values()]

  const comparisonByRunId = new Map((compare?.entries ?? []).map((entry) => [entry.run_id, entry]))
  // `doneRuns` (via everDoneByHarness) picks each harness's own latest done
  // run independently of any other harness's profile  -  right for
  // hasStaleComparison above, wrong for what actually gets shown/judged as
  // "this comparison": the backend's `compare` has already resolved ONE
  // coherent profile group server-side
  // (_resolve_ever_done_provider_config_id in routers/runs.py), which can
  // legitimately be an OLDER profile than some harness's current run (e.g.
  // claude-code/codex got re-run under a newer profile that never
  // included OnDemand  -  the resolved group then correctly stays on the
  // last profile all three harnesses actually share). Filtering doneRuns
  // down to the resolved run ids is wrong here: those specific run objects
  // (the older ones) may not even be in doneRuns, which already replaced
  // them with each harness's newer current run  -  filtering would just
  // drop that harness from the row entirely (this is exactly what
  // happened: a task with 3 harnesses ever done showed only 1). Instead,
  // look the resolved run ids up directly from the full current+history
  // pool, so every harness `compare` includes actually renders.
  const allRunsById = new Map([...(runs ?? []), ...(history ?? [])].map((r) => [r.id, r]))
  const resolvedRuns = (compare?.entries ?? []).map((entry) => allRunsById.get(entry.run_id)).filter(Boolean)
  // A battle's round id is shared by every harness it started. Compare the
  // active/failed runs with the resolved completed result by that id, not by
  // whether each harness happens to have an older success in history. The
  // latter split one live battle as soon as OnDemand finished before Codex
  // or Claude Code: their old successes looked "stale" even though all
  // three current runs belonged to the same round.
  const activeOrFailed = [...activeRuns, ...failedRuns]
  const activeRoundIds = new Set(activeOrFailed.map((run) => run.round_id).filter((roundId) => roundId != null))
  const resolvedRoundIds = new Set(resolvedRuns.map((run) => run.round_id).filter((roundId) => roundId != null))
  const hasRoundIdentity = activeRoundIds.size > 0 && resolvedRoundIds.size > 0
  const hasStaleComparison = hasRoundIdentity
    ? [...activeRoundIds].some((roundId) => !resolvedRoundIds.has(roundId))
    : doneRuns.some((run) => !(runs ?? []).some((current) => current.id === run.id))
  const entries = resolvedRuns.map((run) => {
    const comparison = comparisonByRunId.get(run.id) ?? {}
    const harness = harnessesByKey[run.harness_key]
    const harnessName = harness?.name ?? run.harness_key
    return {
      ...comparison,
      run_id: run.id,
      round_id: run.round_id,
      label: harnessName,
      harness_key: run.harness_key,
      harness_name: harnessName,
      deliverables: run.deliverables,
      deliverables_done: run.deliverables_done ?? run.deliverables.length,
      deliverables_expected: run.deliverables_expected ?? 0,
      model: run.model,
      provider_config_id: run.provider_config_id,
      score: comparison.already_scored,
      submitted_by: run.submitted_by,
    }
  })
  const progressEntries = activeRuns.map((run) => {
    const harness = harnessesByKey[run.harness_key]
    return {
      run_id: run.id,
      round_id: run.round_id,
      harness_key: run.harness_key,
      harness_name: harness?.name ?? run.harness_key,
      model: run.model,
      done: run.deliverables_done ?? 0,
      expected: run.deliverables_expected ?? 0,
      status: run.status,
      retrying: Boolean(run.is_retrying),
      can_stop: Boolean(run.can_stop),
      submitted_by: run.submitted_by,
    }
  })
  const failedEntries = failedRuns.map((run) => ({
    run_id: run.id,
    round_id: run.round_id,
    harness_key: run.harness_key,
    harness_name: harnessesByKey[run.harness_key]?.name ?? run.harness_key,
    model: run.model,
    error_message: run.error_message,
    can_retry: run.can_retry,
    submitted_by: run.submitted_by,
  }))
  const scored = entries.filter((e) => e.score != null).sort((a, b) => b.score - a.score)
  // Per-harness output counts can reveal a harness identity before the
  // viewer submits their blind judgement  -  hide unless the counts happen
  // to already agree (equal counts carry no such signal). But that
  // agree-or-not comparison only means anything once every harness in
  // this round has actually finished: while any harness is still
  // in-flight, a done harness's real count (e.g. "2/2" while the others
  // are still generating) leaks on its own  -  there's nothing to compare
  // it against yet, so it can't be "equal", and showing it early reveals
  // exactly the kind of signal (which harness finished first, with how
  // much output) this is meant to withhold until everyone's done.
  const hideDeliverableCounts =
    !judged && (inFlight || new Set(entries.map((entry) => entry.deliverables_done)).size > 1)
  const generatedDeliverables = entries.reduce((sum, entry) => sum + entry.deliverables_done, 0)
  const expectedDeliverables = entries.reduce((sum, entry) => sum + entry.deliverables_expected, 0)

  // Independent of THIS viewer's own `judged` flag  -  community_avg_score
  // comes from every user who's scored it (see CompareEntry's docstring),
  // so this is true whenever ANYONE has, including for a signed-out
  // visitor who could never be `judged` themselves. Used below so "no one
  // has judged this yet" and "others have, you haven't" read as two
  // different labels instead of both being lumped into one misleading
  // "Awaiting judgement".
  const communityJudged = entries.some((e) => (e.community_vote_count ?? 0) > 0)
  const notJudgedByViewerStatus = communityJudged ? 'Awaiting your judgement' : 'Awaiting community & your judgement'

  let outcome = null
  let margin = 0
  if (judged && scored.length >= 2) {
    const top = scored[0].score
    const tie = scored.filter((e) => e.score === top).length > 1
    outcome = tie ? 'Tie' : 'Decisive'
    margin = tie ? 0 : Number((top - scored[1].score).toFixed(1))
  }

  // Computed once and kept on the primary card's expandable history. A
  // previous version also rendered every one as another top-level card,
  // which made a single round appear twice in the Battle Log.
  const pastRounds = pastAttempts(runs, history, new Set(resolvedRuns.map((r) => r.id)), harnessesByKey)

  const EMPTY_ROW = {
    inFlight: false,
    retrying: false,
    doneCount: 0,
    entries: [],
    progressEntries: [],
    failedEntries: [],
    pastAttempts: [],
    outcome: null,
    margin: 0,
    providerConfigId: null,
    latestRunAt: 0,
    hideDeliverableCounts: false,
    generatedDeliverables: 0,
    expectedDeliverables: 0,
  }

  const rows = []
  if (doneRuns.length > 0 && hasStaleComparison) {
    // A genuine old-vs-new split: at least one harness's shown success
    // predates the failure/in-progress run next to it, so keep the frozen
    // comparison untouched in its own card.
    rows.push({
      ...EMPTY_ROW,
      task,
      rowKey: `${task.id_aa}#historical`,
      status: resolveRowStatus({ running: false, queued: false, retrying: false, doneCount: entries.length, hasFailed: false, judged, notJudgedByViewerStatus }),
      doneCount: entries.length,
      hideDeliverableCounts,
      generatedDeliverables,
      expectedDeliverables,
      entries: judged ? scored : entries,
      pastAttempts: pastRounds,
      outcome,
      margin,
      providerConfigId: resolvedRuns[0]?.provider_config_id ?? null,
      latestRunAt: latestRunTime(doneRuns),
    })
    if (inFlight || failedRuns.length > 0) {
      rows.push({
        ...EMPTY_ROW,
        task,
        rowKey: `${task.id_aa}#latest`,
        status: retrying ? 'Retrying failed runs' : runningRuns.length ? 'In progress' : queuedRuns.length ? 'Queued' : 'Failed',
        inFlight,
        running: runningRuns.length > 0,
        queued: queuedRuns.length > 0,
        retrying,
        progressEntries,
        failedEntries,
        latestRunAt: latestRunTime([...activeRuns, ...failedRuns]),
      })
    }
  } else if (doneRuns.length > 0 || inFlight || failedRuns.length > 0) {
    // Same round, no staleness to protect  -  done, in-progress, and failed
    // harnesses from this one attempt all show together in a single card.
    rows.push({
      ...EMPTY_ROW,
      task,
      rowKey: `${task.id_aa}#current`,
      status: resolveRowStatus({
        running: runningRuns.length > 0,
        queued: queuedRuns.length > 0,
        retrying,
        doneCount: entries.length,
        hasFailed: failedEntries.length > 0,
        judged,
        notJudgedByViewerStatus,
      }),
      inFlight,
      retrying,
      doneCount: entries.length,
      hideDeliverableCounts,
      generatedDeliverables,
      expectedDeliverables,
      entries: judged ? scored : entries,
      progressEntries,
      failedEntries,
      pastAttempts: pastRounds,
      outcome,
      margin,
      providerConfigId: resolvedRuns[0]?.provider_config_id ?? null,
      latestRunAt: latestRunTime([...doneRuns, ...activeRuns, ...failedRuns]),
    })
  }
  if (rows.length === 0) {
    rows.push({ ...EMPTY_ROW, task, rowKey: `${task.id_aa}#empty`, status: 'Not run' })
  }
  // Admin delete/restore acts on the whole task, not one card  -  only the
  // first card for a task carries those controls, so there's never two
  // "Delete task" buttons for the same task.
  rows[0].isPrimaryCard = true
  return rows
}

function buildRows(task, runs, history, compare, harnessesByKey) {
  const allRunsById = new Map()
  for (const run of [...(history ?? []), ...(runs ?? [])]) allRunsById.set(run.id, run)
  const grouped = new Map()
  for (const run of allRunsById.values()) {
    const key = run.round_id ?? `run-${run.id}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(run)
  }

  if (!grouped.size) {
    return [{
      task,
      rowKey: `${task.id_aa}#empty`,
      status: 'Not run',
      inFlight: false,
      retrying: false,
      doneCount: 0,
      entries: [],
      progressEntries: [],
      failedEntries: [],
      pastAttempts: [],
      outcome: null,
      margin: 0,
      providerConfigId: null,
      latestRunAt: 0,
      hideDeliverableCounts: false,
      generatedDeliverables: 0,
      expectedDeliverables: 0,
      isPrimaryCard: true,
    }]
  }

  const comparisonByRunId = new Map((compare?.entries ?? []).map((entry) => [entry.run_id, entry]))
  const rows = [...grouped.entries()].map(([key, groupRuns]) => {
    const sortedRuns = [...groupRuns].sort((a, b) => a.id - b.id)
    const doneRuns = sortedRuns.filter((run) => run.status === 'done')
    const progressRuns = sortedRuns.filter((run) => run.status === 'pending' || run.status === 'running')
    const failedRuns = sortedRuns.filter((run) => run.status === 'error' || run.status === 'stopped')
    const running = progressRuns.some((run) => run.status === 'running')
    const queued = progressRuns.some((run) => run.status === 'pending')
    const retrying = progressRuns.some((run) => run.is_retrying)

    const entries = doneRuns.map((run) => {
      const comparison = comparisonByRunId.get(run.id) ?? {}
      const harness = harnessesByKey[run.harness_key]
      const harnessName = harness?.name ?? run.harness_key
      return {
        ...comparison,
        run_id: run.id,
        round_id: run.round_id,
        label: harnessName,
        harness_key: run.harness_key,
        harness_name: harnessName,
        deliverables: run.deliverables,
        deliverables_done: run.deliverables_done ?? run.deliverables.length,
        deliverables_expected: run.deliverables_expected ?? 0,
        model: run.model,
        provider_config_id: run.provider_config_id,
        score: comparison.already_scored ?? run.already_scored,
        community_avg_score: comparison.community_avg_score ?? run.community_avg_score,
        community_vote_count: comparison.community_vote_count ?? run.community_vote_count,
        submitted_by: run.submitted_by,
      }
    })
    const progressEntries = progressRuns.map((run) => ({
      run_id: run.id,
      round_id: run.round_id,
      harness_key: run.harness_key,
      harness_name: harnessesByKey[run.harness_key]?.name ?? run.harness_key,
      model: run.model,
      done: run.deliverables_done ?? 0,
      expected: run.deliverables_expected ?? 0,
      status: run.status,
      retrying: Boolean(run.is_retrying),
      can_stop: Boolean(run.can_stop),
      submitted_by: run.submitted_by,
    }))
    const failedEntries = failedRuns.map((run) => ({
      run_id: run.id,
      round_id: run.round_id,
      harness_key: run.harness_key,
      harness_name: harnessesByKey[run.harness_key]?.name ?? run.harness_key,
      model: run.model,
      status: run.status,
      error_message: run.error_message || (run.status === 'stopped' ? 'Run stopped.' : ''),
      can_retry: Boolean(run.can_retry),
      submitted_by: run.submitted_by,
    }))
    const judged = entries.some((entry) => entry.score != null)
    const communityJudged = entries.some((entry) => (entry.community_vote_count ?? 0) > 0)
    const notJudgedByViewerStatus = communityJudged ? 'Awaiting your judgement' : 'Awaiting community & your judgement'
    const scored = entries.filter((entry) => entry.score != null).sort((a, b) => b.score - a.score)
    let outcome = null
    let margin = 0
    if (judged && scored.length >= 2) {
      const top = scored[0].score
      const tie = scored.filter((entry) => entry.score === top).length > 1
      outcome = tie ? 'Tie' : 'Decisive'
      margin = tie ? 0 : Number((top - scored[1].score).toFixed(1))
    }
    const inFlight = progressRuns.length > 0
    const hideDeliverableCounts = !judged && (inFlight || new Set(entries.map((entry) => entry.deliverables_done)).size > 1)
    return {
      task,
      rowKey: `${task.id_aa}#${key}`,
      status: resolveRowStatus({
        running,
        queued,
        retrying,
        doneCount: entries.length,
        hasFailed: failedEntries.length > 0,
        judged,
        notJudgedByViewerStatus,
      }),
      inFlight,
      retrying,
      doneCount: entries.length,
      entries: judged ? scored : entries,
      progressEntries,
      failedEntries,
      pastAttempts: [],
      outcome,
      margin,
      providerConfigId: sortedRuns[0]?.provider_config_id ?? null,
      latestRunAt: latestRunTime(sortedRuns),
      hideDeliverableCounts,
      generatedDeliverables: entries.reduce((sum, entry) => sum + entry.deliverables_done, 0),
      expectedDeliverables: entries.reduce((sum, entry) => sum + entry.deliverables_expected, 0),
    }
  })
  rows.sort((a, b) => b.latestRunAt - a.latestRunAt)
  rows[0].isPrimaryCard = true
  return rows
}

const STATUS_TONE = {
  Queued: 'text-ink-3',
  'In progress': 'text-warn',
  'Retrying failed runs': 'text-amber-600',
  'Partially failed': 'text-warn',
  Failed: 'text-bad',
  // Exactly one done harness  -  judging needs two (see resolveRowStatus
  // and routers/scores.py's submit_scores, which now rejects this too).
  // Reddish like Failed, but a distinct label: this round isn't broken,
  // it's just not comparable yet.
  'Insufficient results to judge': 'text-bad',
  Judged: 'text-good',
  // Distinct tones on purpose: the community having already judged it
  // means the ball's in your court specifically, so that one gets the
  // warmer/more urgent "status-awaiting" tone. Nobody having judged it at
  // all yet is a different situation, not "nothing to see"  -  text-link
  // keeps it visibly distinct from both that and the muted "Not run" gray.
  'Awaiting your judgement': 'status-awaiting',
  'Awaiting community & your judgement': 'text-link',
  'Not run': 'text-ink-3',
}

/** Failed runs, with a Retry the submitter (or the admin) can use. Retrying
 *  deliberately doesn't consume the daily task quota  -  see
 *  backend/app/rate_limit.py. */
/** A harness still generating  -  this used to have nothing to expand into
 *  (canExpand ignored progressEntries entirely), so a purely in-progress
 *  round had no chevron at all and the only way "in" was the task title
 *  link, straight to the judge page with nothing done yet to show. */
function InProgressRuns({ entries, onStop, busyRunIds, isAdmin }) {
  const [viewingRun, setViewingRun] = useState(null)
  if (!entries.length) return null
  const hasRetrying = entries.some((entry) => entry.retrying)
  const hasRunning = entries.some((entry) => entry.status === 'running')
  return (
    <div className="border-t border-line bg-warn/5 px-4 py-3">
      <p className={`font-mono-arena text-[10px] uppercase tracking-wider ${hasRetrying ? 'text-amber-600' : 'text-warn'}`}>
        {hasRetrying ? 'Retrying failed runs' : hasRunning ? 'In progress' : 'Queued'} ({entries.length})
      </p>
      <div className="mt-2 space-y-1.5">
        {entries.map((e) => (
          <div key={e.run_id} className="flex items-center gap-2 text-xs">
            <HarnessAvatar harnessKey={e.harness_key} name={e.harness_name} size={16} />
            <span className="shrink-0">{e.harness_name}</span>
            <ModelBadge model={e.model} />
            <span className={e.status === 'pending' ? 'text-ink-3' : 'text-warn'}>{e.status === 'pending' ? 'Queued' : 'Running'}</span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {e.status === 'running' && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-floating px-2.5 py-0.5 font-mono-arena text-[10px] font-medium uppercase tracking-wider text-ink-2 transition-colors hover:border-warn/40 hover:bg-warn/10 hover:text-warn"
                  onClick={() => setViewingRun(e)}
                >
                  <IconCode className="text-[10px]" aria-hidden="true" />
                  Logs
                </button>
              )}
              {isAdmin && e.can_stop && (
                <button type="button" className="shrink-0 text-bad hover:underline disabled:opacity-50" disabled={busyRunIds.has(e.run_id)} onClick={() => onStop(e.run_id)}>
                  {busyRunIds.has(e.run_id) ? 'Stopping…' : 'Stop'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {viewingRun && (
        <RunLogStreamModal
          runId={viewingRun.run_id}
          harnessName={viewingRun.harness_name}
          onClose={() => setViewingRun(null)}
        />
      )}
    </div>
  )
}

function FailedRuns({ entries, onRetry, onDelete, busyRunIds, isAdmin }) {
  if (!entries.length) return null
  return (
    <div className="border-t border-line bg-bad/5 px-4 py-3">
      <p className="font-mono-arena text-[10px] uppercase tracking-wider text-bad">
        Failed ({entries.length})
      </p>
      <div className="mt-2 space-y-1.5">
        {entries.map((e) => {
          // Scoped to THIS entry's own run id  -  a flat boolean covering
          // every failed harness in the row would show "Retrying…" (and
          // disable Retry/Delete) on every one of them the moment you
          // clicked just one.
          const isBusy = busyRunIds.has(e.run_id)
          return (
            <div key={e.run_id} className="flex flex-wrap items-center gap-2 text-xs">
              <HarnessAvatar harnessKey={e.harness_key} name={e.harness_name} size={16} />
              <span className="shrink-0">{e.harness_name}</span>
              <ModelBadge model={e.model} />
              <span className="min-w-0 flex-1 truncate text-ink-3" title={e.error_message}>
                {e.error_message}
              </span>
              {e.can_retry ? (
                <button
                  type="button"
                  className="shrink-0 text-link hover:underline disabled:opacity-50"
                  disabled={isBusy}
                  onClick={() => onRetry(e.run_id)}
                >
                  {isBusy ? 'Retrying…' : 'Retry'}
                </button>
              ) : (
                e.submitted_by && <span className="shrink-0 text-ink-3">run by {e.submitted_by}</span>
              )}
              {isAdmin && (e.status ?? 'error') === 'error' && (
                <button
                  type="button"
                  className="shrink-0 text-bad hover:underline disabled:opacity-50"
                  disabled={isBusy}
                  onClick={() => onDelete(e.run_id)}
                >
                  Delete
                </button>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">Retrying a failed run doesn’t count against the daily task limit.</p>
    </div>
  )
}

function ComparisonTable({ entries, hideDeliverableCounts }) {
  const maxFiles = Math.max(...entries.map((e) => e.deliverables_done), 1)
  // Nothing to "agree" or "disagree" about until the AI judge has actually
  // scored at least one of these outputs  -  showing a flat "N/A" row before
  // then implies a comparison exists when there's really nothing there yet.
  const anyJudged = entries.some((e) => e.judge_score != null)
  return (
    <div className="overflow-x-auto border-t border-line bg-floating">
      <table className="w-full min-w-[560px] text-[12px]">
        <thead>
          <tr className="text-left">
            <th className="w-40 px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
              Metric
            </th>
            {entries.map((e, i) => (
              <th key={e.run_id} className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <IdentityStrip harnessKey={e.harness_key} className="h-4" />
                  {e.harness_key ? (
                    <HarnessAvatar harnessKey={e.harness_key} name={e.harness_name} size={18} />
                  ) : (
                    <SlotBadge index={i} letter={(e.label || String.fromCharCode(65 + i)).slice(-1)} size={18} />
                  )}
                  <span className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-2">
                    {e.harness_name}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-ink-2">
          <tr className="border-t border-line">
            <td className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">Model</td>
            {entries.map((e) => (
              <td key={e.run_id} className="px-4 py-2">
                {e.model ? <ModelBadge model={e.model} /> : <span className="text-ink-3">N/A</span>}
              </td>
            ))}
          </tr>
          <tr className="border-t border-line">
            <td className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">Your score</td>
            {entries.map((e) => (
              <td key={e.run_id} className="px-4 py-2 font-mono-arena">
                {e.score != null ? `${e.score}/10` : 'N/A'}
              </td>
            ))}
          </tr>
          <tr className="border-t border-line">
            <td className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
              Community rating
            </td>
            {entries.map((e) => (
              <td key={e.run_id} className="px-4 py-2">
                {e.community_vote_count > 0 ? (
                  <span className="flex items-center gap-1.5 font-mono-arena">
                    <StarRating score={e.community_avg_score} votes={e.community_vote_count} />
                    <span>{e.community_avg_score}/10</span>
                  </span>
                ) : (
                  <span className="font-mono-arena text-ink-3">no votes yet</span>
                )}
              </td>
            ))}
          </tr>
          <tr className="border-t border-line">
            <td className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">Artificial Analysis AI judge</td>
            {entries.map((e) => (
              <td key={e.run_id} className="px-4 py-2 font-mono-arena">
                {e.judge_score != null ? (
                  `${e.judge_score}/10`
                ) : (
                  <span className="text-ink-3" title={e.judge_note || 'Artificial Analysis AI judge coming soon'}>
                    Coming soon
                  </span>
                )}
              </td>
            ))}
          </tr>
          {anyJudged && (
            <tr className="border-t border-line">
              <td className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">Agreement</td>
              {entries.map((e) => {
                const d = e.score != null && e.judge_score != null ? Number((e.score - e.judge_score).toFixed(1)) : null
                return (
                  <td key={e.run_id} className="px-4 py-2 font-mono-arena">
                    {d == null ? 'N/A' : d === 0 ? <span className="text-good">exact</span> : `${d > 0 ? '+' : ''}${d}`}
                  </td>
                )
              })}
            </tr>
          )}
          <tr className="border-t border-line">
            <td className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
              Deliverables
            </td>
            {entries.map((e) => (
              <td key={e.run_id} className="px-4 py-2">
                {hideDeliverableCounts ? (
                  <span className="font-mono-arena text-ink-3">hidden until judged</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RateBar value={e.deliverables_done / Math.max(e.deliverables_expected, maxFiles)} color={identityColor(e.harness_key)} />
                    <span className="font-mono-arena">{e.deliverables_done}/{e.deliverables_expected}</span>
                  </span>
                )}
              </td>
            ))}
          </tr>
          <tr className="border-t border-line">
            <td className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
              Judge criteria
            </td>
            {entries.map((e) => (
              <td key={e.run_id} className="px-4 py-2 font-mono-arena text-[11px]">
                {e.judge_breakdown?.length ? `${e.judge_breakdown.length} scored` : 'N/A'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function PastAttempts({ taskId, attempts, onInsufficientResults }) {
  if (!attempts.length) return null
  return (
    <div className="border-t border-line bg-floating px-4 py-3">
      <p className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
        Earlier runs on this task ({attempts.length})
      </p>
      <div className="mt-2 space-y-2">
        {attempts.map((round) => (
          <div key={round.key} className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            {round.harnesses.map((h) => (
              <span key={h.run_id} className="flex items-center gap-1">
                <HarnessAvatar harnessKey={h.harness_key} name={h.harness_name} size={16} />
                <span className="min-w-0 truncate">{h.harness_name}</span>
              </span>
            ))}
            <ModelBadge model={round.harnesses[0]?.model} />
            <span
              className="font-mono-arena text-[10px] text-ink-3"
              title={round.round_id != null ? `Battle round ${round.round_id}` : `Run #${round.run_ids[0]} (predates round tracking)`}
            >
              {round.round_id != null ? `Round ${roundLabel(round.round_id)}` : `#${round.run_ids[0]}`}
            </span>
            {round.when && <span className="font-mono-arena text-[10px] text-ink-3">{new Date(round.when).toLocaleString()}</span>}
            {/* One or more completed runs is a valid `runs=` selection  -
                /api/scores/compare accepts any set of done, non-deleted run
                ids with at most one per harness (see _selected_done_runs),
                so this opens the exact same Eval page scoped to this whole
                archived round  -  every harness that ran together in it,
                deliverables and all  -  without disturbing whatever's the
                live current comparison for the task. */}
            <Link
              to={`/eval/${taskId}?runs=${round.run_ids.join(',')}`}
              state={{ from: '/battles' }}
              className="ml-auto shrink-0 text-link hover:underline"
              onClick={(event) => {
                if (round.run_ids.length >= 2) return
                event.preventDefault()
                onInsufficientResults()
              }}
            >
              View results
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}


function BattleRow({ row, onRetry, onStop, onDeleteFailedRun, onDeleteRound, busyRunIds, isAdmin, onDeleteResults, onDeleteTask, onRestore, onResetScores, onInsufficientResults }) {
  const [open, setOpen] = useState(false)
  const { task, entries, progressEntries, pastAttempts, failedEntries, outcome, margin, status, doneCount, inFlight, providerConfigId, latestRunAt, hideDeliverableCounts, generatedDeliverables, expectedDeliverables } =
    row
  // Failures expand too  -  that's where the Retry lives.
  const canExpand = entries.length > 0 || pastAttempts.length > 0 || failedEntries.length > 0 || progressEntries.length > 0
  const judgeParams = new URLSearchParams()
  if (providerConfigId != null) judgeParams.set('model', providerConfigId)
  if (entries.length > 0) judgeParams.set('runs', entries.map((entry) => entry.run_id).join(','))
  const judgeHref = `/eval/${task.id_aa}${judgeParams.size ? `?${judgeParams}` : ''}`
  const canJudge = doneCount >= 2
  // One id for the whole battle (every harness run together in one
  // trigger), not each harness's own separate run id  -  see runner.py's
  // round_id. Absent on runs that predate this field.
  const roundId = entries[0]?.round_id ?? progressEntries[0]?.round_id ?? failedEntries[0]?.round_id

  if (task.is_deleted) {
    return (
      <div className="card border-dashed border-bad/50 bg-bad/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display font-semibold">{task.title}</p>
          </div>
          {isAdmin && (
            <button type="button" className="btn-secondary text-sm" onClick={() => onRestore(task)}>
              Restore task
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="card relative overflow-hidden">
      {roundId != null && (
        <span
          className="absolute left-4 top-3 rounded bg-elevated px-1.5 py-0.5 font-mono-arena text-[9px] text-ink-3"
          title={`Battle round ${roundId}  -  every harness shown here ran together in this one trigger`}
        >
          Round {roundLabel(roundId)}
        </span>
      )}
      <div className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${roundId != null ? 'pt-9' : ''}`}>
        {/* Battle Log is intentionally named. The evaluation screen alone
            anonymizes outputs to A/B/C for blind judging. */}
        <div className="w-full shrink-0 space-y-1.5 sm:w-80">
          {entries.length === 0 ? (
            inFlight ? (
              progressEntries.map((entry) => (
                <div key={entry.run_id} className="flex items-center gap-2 text-sm">
                  <IdentityStrip harnessKey={entry.harness_key} className="h-5" />
                  <HarnessAvatar harnessKey={entry.harness_key} name={entry.harness_name} size={24} />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{entry.harness_name}</span>
                </div>
              ))
            ) : failedEntries.length > 0 ? (
              // Nothing's done and nothing's active, but a run did happen  -
              // show the harnesses that were actually selected and failed,
              // not a bare "no runs" that erases what was just attempted.
              failedEntries.map((entry) => (
                <div key={entry.run_id} className="flex items-center gap-2 text-sm">
                <IdentityStrip harnessKey={entry.harness_key} className="h-5" />
                <HarnessAvatar harnessKey={entry.harness_key} name={entry.harness_name} size={24} />
                <span className="min-w-0 flex-1 truncate text-ink-2">{entry.harness_name}</span>
              </div>
              ))
            ) : (
              <p className="text-xs text-ink-3">No runs yet</p>
            )
          ) : (
            <>
            {entries.map((e, i) => {
              const isWinner = i === 0 && outcome === 'Decisive'
              return (
                <div key={e.run_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <IdentityStrip harnessKey={e.harness_key} className="h-5" />
                    {e.harness_key ? (
                      <HarnessAvatar harnessKey={e.harness_key} name={e.harness_name || e.label} size={24} />
                    ) : (
                      <SlotBadge index={i} letter={(e.label || String.fromCharCode(65 + i)).slice(-1)} size={24} />
                    )}
                    {/* No truncate here on purpose  -  a harness's own name is
                        short and should always read in full, never clipped
                        to make room for the badges after it (those wrap to
                        their own line instead, see the container above). */}
                    <span className={`whitespace-nowrap text-sm ${isWinner ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                      {e.harness_name || e.label}
                    </span>
                    {isWinner && (
                      <span className="shrink-0" title="Winner" aria-label="Winner">
                        🏆
                      </span>
                    )}
                    {e.score != null && (
                      <span className="shrink-0 font-mono-arena text-xs text-ink-3">{e.score}/10</span>
                    )}
                  </span>
                  <StarRating score={e.community_avg_score} votes={e.community_vote_count} pushRight />
                </div>
              )
            })}
            {progressEntries.map((entry) => (
              <div key={entry.run_id} className="flex items-center gap-2 text-sm">
                <IdentityStrip harnessKey={entry.harness_key} className="h-5" />
                <HarnessAvatar harnessKey={entry.harness_key} name={entry.harness_name} size={24} />
                <span className="min-w-0 flex-1 truncate text-ink-2">{entry.harness_name}</span>
              </div>
            ))}
            {/* A harness that failed this same round belongs alongside the
                ones that succeeded  -  collapsed or not, this is one round's
                full result, not just the winners. The row's own status
                badge already says "Partially failed"; no need to repeat it
                on every avatar too. */}
            {failedEntries.map((entry) => (
              <div key={entry.run_id} className="flex items-center gap-2 text-sm">
                <IdentityStrip harnessKey={entry.harness_key} className="h-5" />
                <HarnessAvatar harnessKey={entry.harness_key} name={entry.harness_name} size={24} />
                <span className="min-w-0 flex-1 truncate text-ink-2">{entry.harness_name}</span>
              </div>
            ))}
            </>
          )}
        </div>

        {/* Task */}
        <Link
          to={judgeHref}
          state={{ from: '/battles' }}
          className="min-w-0 flex-1 group"
          onClick={(event) => {
            if (canJudge) return
            event.preventDefault()
            onInsufficientResults()
          }}
        >
          <p className="flex items-center gap-1.5 font-display font-semibold group-hover:text-link">
            {task.title}
            {isWebProjectTask(task) && (
              <span className="inline-flex shrink-0 text-link" title="Web app task" aria-label="Web app task">
                {/* Sized off the title it sits beside (the icon is 1em
                    square), not pinned smaller — at text-sm against this
                    serif title it shrank to an unreadable speck. */}
                <IconBrowser className="text-base" />
              </span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Tag>{categoryLabel(task)}</Tag>
            <ModelBadge model={entries[0]?.model ?? progressEntries[0]?.model ?? failedEntries[0]?.model} />
          </div>
        </Link>

        {/* Outcome + expander */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-left sm:text-right">
            {outcome ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono-arena text-xs font-semibold ${
                  outcome === 'Tie' ? 'bg-elevated text-ink-2' : 'bg-good/15 text-good'
                }`}
              >
                {outcome === 'Decisive' ? `▲ +${margin} margin` : '= tie'}
              </span>
            ) : (
              <p className={`text-sm font-semibold ${STATUS_TONE[status]}`}>{status}</p>
            )}
            <p className="mt-1 font-mono-arena text-[11px] text-ink-3">
              {inFlight && progressEntries.length ? (
                `${progressEntries.reduce((sum, entry) => sum + entry.done, 0)}/${progressEntries.reduce((sum, entry) => sum + entry.expected, 0)} deliverables generated`
              ) : hideDeliverableCounts ? (
                'Deliverable counts hidden until judged'
              ) : doneCount > 0 ? (
                `${generatedDeliverables}/${expectedDeliverables} deliverables generated`
              ) : failedEntries.length > 0 ? null : (
                '0 outputs'
              )}
              {pastAttempts.length > 0 && ` · ${pastAttempts.length} earlier run${pastAttempts.length === 1 ? '' : 's'}`}
            </p>
            {timeAgo(latestRunAt) && (
              <p className="mt-1 text-[11px] text-ink-3">{timeAgo(latestRunAt)}</p>
            )}
            {(entries[0]?.submitted_by ?? progressEntries[0]?.submitted_by ?? failedEntries[0]?.submitted_by) && (
              <span className="mt-1 inline-block rounded-full bg-elevated px-2 py-0.5 font-mono-arena text-[9px] uppercase tracking-wider text-ink-3">
                run by {entries[0]?.submitted_by ?? progressEntries[0]?.submitted_by ?? failedEntries[0]?.submitted_by}
              </span>
            )}
          </div>
          {canExpand && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? 'Hide comparison' : 'Show comparison'}
              className="rounded p-1 text-ink-3 hover:bg-elevated hover:text-ink"
            >
              <IconChevron className={`text-sm transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {open && canExpand && (
        <>
          {entries.length > 0 && <ComparisonTable entries={entries} hideDeliverableCounts={hideDeliverableCounts} />}
          <InProgressRuns entries={progressEntries} onStop={onStop} busyRunIds={busyRunIds} isAdmin={isAdmin} />
          <FailedRuns entries={failedEntries} onRetry={onRetry} onDelete={onDeleteFailedRun} busyRunIds={busyRunIds} isAdmin={isAdmin} />
          <PastAttempts taskId={task.id_aa} attempts={pastAttempts} onInsufficientResults={onInsufficientResults} />
        </>
      )}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-xs">
          <span className="font-mono-arena uppercase tracking-wider text-ink-3">Admin</span>
          {roundId != null && (
            <button
              type="button"
              className="text-bad hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              disabled={inFlight}
              title={inFlight ? 'Stop or wait for active runs in this round before deleting it.' : undefined}
              onClick={() => onDeleteRound(roundId)}
            >
              Delete this round
            </button>
          )}
          {row.isPrimaryCard && (doneCount > 0 || failedEntries.length > 0 || pastAttempts.length > 0) && (
            <button type="button" className="text-bad hover:underline" onClick={() => onDeleteResults(task)}>
              Delete results
            </button>
          )}
          {row.isPrimaryCard && entries.length > 0 && (
            <button type="button" className="text-bad hover:underline" onClick={() => onResetScores(task)}>
              Reset scores
            </button>
          )}
          {row.isPrimaryCard && task.results_deleted && (
            <button type="button" className="text-link" onClick={() => onRestore(task)}>
              Restore deleted results
            </button>
          )}
          {/* "Delete task" removes the whole task, not one card  -  keep it on
              just the primary card so there's never two of these buttons
              for the same task (see buildRows' isPrimaryCard comment). */}
          {row.isPrimaryCard && (
            <button type="button" className="text-bad hover:underline" onClick={() => onDeleteTask(task)}>
              Delete task
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Map a `/api/runs/board` row into the shape BattleRow expects. */
function mapBoardEntry(entry) {
  return {
    ...entry,
    run_id: entry.run_id ?? entry.id,
    score: entry.already_scored ?? entry.score,
    harness_name: entry.harness_name ?? entry.label,
    deliverables_done: entry.deliverables_done ?? entry.deliverables?.length ?? 0,
    deliverables_expected: entry.deliverables_expected ?? 0,
  }
}

function mapBoardProgressEntry(entry) {
  return {
    run_id: entry.run_id ?? entry.id,
    round_id: entry.round_id,
    harness_key: entry.harness_key,
    harness_name: entry.harness_name ?? entry.harness_key,
    model: entry.model,
    done: entry.deliverables_done ?? entry.done ?? 0,
    expected: entry.deliverables_expected ?? entry.expected ?? 0,
    status: entry.status,
    retrying: Boolean(entry.is_retrying ?? entry.retrying),
    can_stop: Boolean(entry.can_stop),
    submitted_by: entry.submitted_by,
  }
}

function mapBoardFailedEntry(entry) {
  return {
    run_id: entry.run_id ?? entry.id,
    round_id: entry.round_id,
    harness_key: entry.harness_key,
    harness_name: entry.harness_name ?? entry.harness_key,
    model: entry.model,
    status: entry.status,
    error_message: entry.error_message || (entry.status === 'stopped' ? 'Run stopped.' : ''),
    can_retry: Boolean(entry.can_retry),
    submitted_by: entry.submitted_by,
  }
}

function mapBoardRow(apiRow) {
  const entries = (apiRow.entries ?? []).map(mapBoardEntry)
  const judged = entries.some((entry) => entry.score != null)
  const progressEntries = (apiRow.progress_entries ?? []).map(mapBoardProgressEntry)
  const failedEntries = (apiRow.failed_entries ?? []).map(mapBoardFailedEntry)
  const inFlight =
    progressEntries.length > 0 || ['In progress', 'Queued', 'Retrying failed runs'].includes(apiRow.status)
  const hideDeliverableCounts =
    !judged && (inFlight || new Set(entries.map((entry) => entry.deliverables_done)).size > 1)
  const displayEntries = judged
    ? [...entries].filter((entry) => entry.score != null).sort((a, b) => b.score - a.score)
    : entries
  return {
    task: apiRow.task,
    rowKey: apiRow.row_key,
    status: apiRow.status,
    outcome: apiRow.outcome,
    margin: apiRow.margin ?? 0,
    entries: displayEntries,
    progressEntries,
    failedEntries,
    pastAttempts: apiRow.past_attempts ?? [],
    doneCount: entries.length,
    inFlight,
    retrying: apiRow.status === 'Retrying failed runs',
    isPrimaryCard: apiRow.is_primary_card,
    providerConfigId: entries[0]?.provider_config_id ?? progressEntries[0]?.provider_config_id ?? null,
    latestRunAt: apiRow.latest_run_at ? new Date(apiRow.latest_run_at).getTime() : 0,
    hideDeliverableCounts,
    generatedDeliverables: entries.reduce((sum, entry) => sum + (entry.deliverables_done ?? 0), 0),
    expectedDeliverables: entries.reduce((sum, entry) => sum + (entry.deliverables_expected ?? 0), 0),
  }
}

export default function BattleLog() {
  const { user } = useAuth()
  const isAdmin = Boolean(user?.is_admin)
  const [category, setCategory] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [outcome, setOutcome] = useState('')
  const [runOrder, setRunOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState([])
  const [busyRunIds, setBusyRunIds] = useState(() => new Set())
  const [error, setError] = useState('')
  const [insufficientResults, setInsufficientResults] = useState(false)

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {})
  }, [])

  const fetchBoard = useCallback(
    async (pageNum) => {
      const result = await api.runsBoard({
        category: category || undefined,
        includeDeleted: isAdmin,
        status: statusFilter || undefined,
        outcome: outcome || undefined,
        sort: runOrder,
        page: pageNum,
        limit: BATTLES_PER_PAGE,
      })
      return {
        rows: (result.rows ?? []).map(mapBoardRow),
        total: result.total ?? 0,
        page: result.page ?? pageNum,
      }
    },
    [category, statusFilter, outcome, runOrder, isAdmin]
  )

  const applyBoardResult = useCallback((result) => {
    setRows(result.rows)
    setTotal(result.total)
  }, [])

  const boardScopeKey = useMemo(
    () => `${isAdmin}:${category}:${statusFilter}:${outcome}:${runOrder}`,
    [isAdmin, category, statusFilter, outcome, runOrder]
  )

  const hasNextBoardPage = useCallback(
    (pageNum, data) => pageNum < Math.max(1, Math.ceil(data.total / BATTLES_PER_PAGE)),
    []
  )

  const { loading, refreshCurrentPage: refreshBoardPage } = useAdjacentPagePrefetch({
    page,
    scopeKey: boardScopeKey,
    fetchPage: fetchBoard,
    applyPage: applyBoardResult,
    hasNextPage: hasNextBoardPage,
  })

  const reloadBoard = useCallback(async () => {
    const result = await refreshBoardPage()
    return result.rows
  }, [refreshBoardPage])

  // Deliverable counts on an in-flight run only change while it's running,
  // so refresh the rows on the same low-frequency cadence as the batch
  // strip  -  but only while something is actually in flight, so an idle
  // Battle Log costs nothing.
  const anyInFlight = rows.some((r) => r.inFlight)
  useEffect(() => {
    if (!anyInFlight) return undefined
    const timer = setInterval(() => {
      reloadBoard().catch(() => {})
    }, BACKGROUND_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [anyInFlight, reloadBoard])

  useEffect(() => {
    function refetchOnReturn() {
      if (document.visibilityState !== 'visible') return
      reloadBoard().catch(() => {})
    }
    document.addEventListener('visibilitychange', refetchOnReturn)
    window.addEventListener('focus', refetchOnReturn)
    return () => {
      document.removeEventListener('visibilitychange', refetchOnReturn)
      window.removeEventListener('focus', refetchOnReturn)
    }
  }, [reloadBoard])

  function setRunBusy(runId, isBusy) {
    setBusyRunIds((current) => {
      const next = new Set(current)
      if (isBusy) next.add(runId)
      else next.delete(runId)
      return next
    })
  }

  async function retry(runId) {
    setRunBusy(runId, true)
    setError('')
    try {
      await api.retryRun(runId)
      await reloadBoard()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunBusy(runId, false)
    }
  }

  async function stop(runId) {
    if (!window.confirm('Stop this harness run? Any incomplete output will be discarded.')) return
    setRunBusy(runId, true)
    setError('')
    try {
      await api.stopRun(runId)
      await reloadBoard()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunBusy(runId, false)
    }
  }

  async function deleteFailedRun(runId) {
    if (!window.confirm('Delete this failed run? This only removes this failed attempt.')) return
    setRunBusy(runId, true)
    setError('')
    try {
      await api.deleteFailedRun(runId)
      await reloadBoard()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunBusy(runId, false)
    }
  }

  async function deleteRound(roundId) {
    if (!window.confirm('Delete this round? Only its runs and deliverables will be removed; other rounds for this task will stay.')) return
    setError('')
    try {
      await api.deleteRound(roundId)
      await reloadBoard()
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteResults(task) {
    if (!window.confirm(`Delete every run, deliverable, score, and AI judge verdict for “${task.title}”? This cannot be undone.`)) return
    try {
      await api.deleteTaskResults(task.id_aa)
      await reloadBoard()
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteTask(task) {
    if (!window.confirm(`Delete “${task.title}” and all of its runs, deliverables, scores, and AI judge data? This cannot be undone.`)) return
    try {
      await api.deleteTask(task.id_aa)
      await reloadBoard()
    } catch (err) {
      setError(err.message)
    }
  }

  async function restore(task) {
    try {
      await api.restoreTask(task.id_aa)
      await reloadBoard()
    } catch (err) {
      setError(err.message)
    }
  }

  async function resetScores(task) {
    if (
      !window.confirm(
        `Reset every community score for “${task.title}”? Everyone's votes and ratings go back to zero  -  the runs and deliverables themselves are unaffected. This cannot be undone.`
      )
    )
      return
    try {
      await api.resetScores(task.id_aa)
      await reloadBoard()
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [category, statusFilter, outcome, runOrder])

  const pageCount = Math.max(1, Math.ceil(total / BATTLES_PER_PAGE))
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount))
  }, [pageCount])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="eyebrow">Battle log</p>
        </div>
        <h1 className="font-display mt-1 text-3xl font-semibold leading-tight sm:text-4xl">Battle Log</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Completed and active battles in the arena. Expand a row for the side-by-side comparison.
        </p>
      </div>

      <RunningBenchmarks />

      {error && <p className="text-sm text-bad">{error}</p>}

      <div className="filter-toolbar filter-toolbar-single-row">
        <div className="filter-field">
          <span className="filter-label">Status</span>
          <ChoiceDropdown compact className="w-full" value={statusFilter} onChange={setStatusFilter} placeholder="All" options={[{ id: '', label: 'All' }, ...STATUS_FILTERS.map((item) => ({ id: item, label: item }))]} />
        </div>
        <div className="filter-field">
          <span className="filter-label">Category</span>
          <ChoiceDropdown compact className="w-full" value={category} onChange={setCategory} placeholder="All" options={[{ id: '', label: 'All' }, ...categories.map((item) => ({ id: item, label: item }))]} />
        </div>
        <div className="filter-field">
          <span className="filter-label">Outcome</span>
          <ChoiceDropdown compact className="w-full" value={outcome} onChange={setOutcome} placeholder="All" options={[{ id: '', label: 'All' }, ...OUTCOME_FILTERS.map((item) => ({ id: item, label: item }))]} />
        </div>
        <div className="filter-field">
          <span className="filter-label">Sort</span>
          <ChoiceDropdown compact className="w-full" value={runOrder} onChange={setRunOrder} placeholder="Newest first" options={[{ id: 'desc', label: 'Newest first' }, { id: 'asc', label: 'Oldest first' }]} />
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading battle history…" />
      ) : total === 0 ? (
        <EmptyState>
          {!category && !statusFilter && !outcome ? (
            <>
              No battles recorded yet. Start one from{' '}
              <Link to="/benchmark" className="text-link">
                Benchmark a new task
              </Link>
              .
            </>
          ) : (
            'No battles match the current filters.'
          )}
        </EmptyState>
      ) : (
        <>
          <p className="eyebrow">
            Showing {rows.length ? (page - 1) * BATTLES_PER_PAGE + 1 : 0}–{(page - 1) * BATTLES_PER_PAGE + rows.length} of {total} battle{total === 1 ? '' : 's'}
          </p>
          <div className="space-y-3">
            {rows.map((r) => (
              <BattleRow
                key={r.rowKey}
                row={r}
                onRetry={retry}
                onStop={stop}
                onDeleteFailedRun={deleteFailedRun}
                onDeleteRound={deleteRound}
                busyRunIds={busyRunIds}
                isAdmin={isAdmin}
                onDeleteResults={deleteResults}
                onDeleteTask={deleteTask}
                onRestore={restore}
                onResetScores={resetScores}
                onInsufficientResults={() => setInsufficientResults(true)}
              />
            ))}
          </div>
          <Pagination page={page} pageCount={pageCount} onChange={setPage} className="pt-2" />
        </>
      )}
      {insufficientResults && <InsufficientResultsToast onClose={() => setInsufficientResults(false)} />}
    </div>
  )
}

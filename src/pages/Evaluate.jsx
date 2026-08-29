import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { api, getUserToken } from '../api.js'
import { useAuth } from '../auth.jsx'
import AuthModal from '../components/AuthModal.jsx'
import ChoiceDropdown from '../components/ChoiceDropdown.jsx'
import JudgeRunPickerModal from '../components/JudgeRunPickerModal.jsx'
import ModelPickerModal from '../components/ModelPickerModal.jsx'
import TaskPromptModal from '../components/TaskPromptModal.jsx'
import { IconBrowser } from '../components/icons.jsx'
import { isWebProjectTask } from '../lib/webProject.js'
import { useAdjacentPagePrefetch } from '../lib/useAdjacentPagePrefetch.js'
import {
  EmptyState,
  FileTypeChips,
  HarnessAvatar,
  LoadingState,
  ModelBadge,
  Notice,
  PageHeader,
  Pagination,
  StatsLine,
  Tag,
} from '../components/ui.jsx'

function runState(runs) {
  if (!runs || !runs.length) return 'none'
  if (runs.some((r) => r.status === 'running')) return 'running'
  if (runs.some((r) => r.status === 'pending')) return 'queued'
  if (runs.some((r) => r.status === 'error')) return 'error'
  if (runs.every((r) => r.status === 'done')) return 'done'
  return 'none'
}

/** Once a harness has ever produced a successful result for this task, that
 *  success stays visible here even if a later Regenerate/retry on that same
 *  harness failed  -  a new failure doesn't erase a prior win, it's just a
 *  separate, currently-failed attempt (visible in Battle Log). Returns one
 *  run per harness_key: the current one if it's done, otherwise the most
 *  recent done run from history. */
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

/** Client-side mirror of backend/app/routers/runs.py's
 *  `_resolve_ever_done_provider_config_id`  -  same candidates
 *  (everDoneByHarness above), same tiebreaker (highest run id, i.e. most
 *  recently done, wins)  -  so refreshTask's single-task compare() call
 *  agrees with what the bulk /api/runs/overview path (which the backend
 *  itself resolves) would show for the same task. Picking anything other
 *  than the most recent match risks a fresh battle (say, Claude Code +
 *  Codex only, deliberately without OnDemand) getting silently overridden
 *  by a stale, larger, older group that happens to include a harness
 *  that wasn't even selected this time. */
function resolveEverDoneProviderConfigId(runs, history) {
  const candidates = [...everDoneByHarness(runs, history).values()]
  if (!candidates.length) return null
  return candidates.reduce((latest, r) => (r.id > latest.id ? r : latest)).provider_config_id ?? null
}

function ModelTags({ runs }) {
  const models = [...new Set((runs || []).filter((r) => r.status === 'done' && r.model).map((r) => r.model))]
  if (!models.length) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {models.map((m) => (
        <ModelBadge key={m} model={m} />
      ))}
    </span>
  )
}

function ActiveRunToast({ message, onClose }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5000)
    return () => window.clearTimeout(timer)
  }, [onClose])

  return createPortal(
    <div role="status" className="fixed bottom-5 left-1/2 z-[100] flex w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-warn/30 bg-floating px-4 py-3 text-sm font-medium text-warn shadow-xl">
      <span className="text-base" aria-hidden="true">⏳</span>
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" className="text-ink-3 hover:text-ink" onClick={onClose} aria-label="Dismiss">×</button>
    </div>,
    document.body
  )
}

function InsufficientResultsToast({ onClose }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [onClose])

  return createPortal(
    <div role="alert" className="fixed bottom-5 left-1/2 z-[100] flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-warn/30 bg-floating px-4 py-3 text-sm font-medium text-warn shadow-xl">
      <span className="text-base" aria-hidden="true">⚠</span>
      <span className="min-w-0 flex-1">Not enough results to judge. Please retry failed ones or try again later.</span>
      <button type="button" className="text-ink-3 hover:text-ink" onClick={onClose} aria-label="Dismiss">×</button>
    </div>,
    document.body
  )
}

/** Every distinct model-profile group with at least one done run  -  current
 *  AND history, same reasoning as compare() itself (see
 *  runner.latest_runs_by_harness with an explicit status/profile filter):
 *  a harness whose most recent attempt failed still counts here if an
 *  earlier attempt under this same profile succeeded.
 *
 *  A group's own `model` comes straight from its runs (whichever is most
 *  recent), not from cross-referencing the signed-in viewer's own visible
 *  provider-profile list  -  a profile owned by someone else (or since
 *  deleted) is invisible to `api.listConfigs()` for this viewer even
 *  though the run itself still plainly recorded what model it used, and
 *  falling back to "Unspecified model" in that case was misleading.
 *
 *  `harnessKeys` is a plain array (not a Set) so callers can map it
 *  straight into avatars/badges. `profileId` is `null` for a valid
 *  legacy/unprofiled group (compare() already handles that)  -  never the
 *  string 'legacy', which used to leak into `?model=legacy` on the judge
 *  link and 422 (`Number('legacy')` is NaN). */
function comparisonGroups(runs, history) {
  const byProfile = new Map()
  for (const run of [...(runs ?? []), ...(history ?? [])]) {
    if (run.status !== 'done') continue
    const key = run.provider_config_id ?? null
    if (!byProfile.has(key)) byProfile.set(key, { harnessKeys: new Set(), latestRunId: run.id, model: run.model })
    const group = byProfile.get(key)
    group.harnessKeys.add(run.harness_key)
    if (run.id >= group.latestRunId) {
      group.latestRunId = run.id
      group.model = run.model || group.model
    }
  }
  return [...byProfile.entries()].map(([profileId, { harnessKeys, latestRunId, model }]) => ({
    profileId,
    harnessKeys: [...harnessKeys],
    harnessCount: harnessKeys.size,
    latestRunId,
    model,
  }))
}

/** A task is judgeable only when at least two DIFFERENT harnesses produced
 *  a result under the SAME model+profile: one output has nothing to compare
 *  against, and two outputs from different models would be a model
 *  comparison, not a harness one.
 *
 *  Returns EVERY such qualifying profile group, not just the best one  -
 *  Regenerate no longer dedupes runs (see backend's run_task), so a task
 *  can genuinely have several distinct comparable "battles" (different
 *  model profiles run at different times) worth judging, not only one
 *  "the" current comparison. */
function judgeableGroups(runs, history) {
  return comparisonGroups(runs, history).filter((g) => g.harnessCount >= 2)
}

/** The single most-recent judgeable group (undefined when none qualify)  -
 *  used wherever only a yes/no "can this be judged at all" or one
 *  representative profile is needed (e.g. TaskCard's canJudge check, and
 *  judge()'s go-straight-in case below). Recency, not harness count, is
 *  the tiebreaker  -  same reasoning as the backend's
 *  _resolve_ever_done_provider_config_id: a fresh battle you just ran
 *  (say, Claude Code + Codex only, deliberately without OnDemand) must
 *  win over a bigger but staler group from days ago, not get silently
 *  passed over for it. See judge() below for the case where more than
 *  one group exists and the user picks. */
function judgeableGroup(runs, history) {
  const groups = judgeableGroups(runs, history)
  if (!groups.length) return undefined
  return groups.reduce((best, g) => (g.latestRunId > best.latestRunId ? g : best)).profileId
}

function TaskCard({ task, runs, history, harnesses, signedIn, isAdmin, judged, hasJudgeVerdict, busy, notice, onBattle, onRegenerate, onJudge, onDeleteResults, onDeleteTask, onRestore, onOpenPrompt }) {
  const state = runState(runs)
  const doneCount = (runs || []).filter((r) => r.status === 'done').length
  const fileCount = task.deliverable_files?.length ?? 0
  const hasRecorded = doneCount > 0
  // "Harnesses evaluated" / "Model used" are a lifetime record, not a
  // snapshot of the latest attempt  -  a harness that succeeded before and
  // then failed on a later regenerate/retry stays listed here.
  const everDone = everDoneByHarness(runs, history)
  const doneHarnesses = new Set(everDone.keys())
  const hasActiveRuns = (runs ?? []).some((run) => run.status === 'pending' || run.status === 'running')
  const canJudge = !hasActiveRuns && judgeableGroup(runs, history) !== undefined
  const canAttemptJudge = !hasActiveRuns && doneHarnesses.size > 0

  if (task.is_deleted) {
    // Only the arena admin's own fetch ever asks for deleted tasks
    // (includeDeleted: isAdmin below), so a non-admin should never reach
    // this branch at all  -  but rendering the restore action itself behind
    // `isAdmin` too means a stale/shared cache entry can never expose a
    // working "Restore task" button (and the 403 it'd trigger) to anyone else.
    return (
      <div className="card border-dashed border-bad/50 bg-bad/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">{task.title}</h2>
          </div>
          {isAdmin && (
            <button type="button" className="btn-secondary text-sm" onClick={onRestore}>Restore task</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="card card-hover flex min-h-[350px] flex-col p-7 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{task.group}</Tag>
          <span className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">{task.category}</span>
        </div>
        {task.submitted_by && (
          <span className="flex items-center gap-1.5 text-xs text-ink-3" title={`Submitted by ${task.submitted_by}`}>
            <span>Submitted by</span>
            <HarnessAvatar harnessKey={task.submitted_by_avatar || task.submitted_by} name={task.submitted_by} size={18} />
            <span>{task.submitted_by}</span>
          </span>
        )}
      </div>

      <h2 className="font-display mt-4 flex items-center gap-2 text-2xl font-semibold leading-tight sm:text-[1.7rem]">
        <button
          type="button"
          className="text-left decoration-1 underline-offset-4 hover:underline focus-visible:underline"
          onClick={onOpenPrompt}
          aria-label={`View prompts for ${task.title}`}
        >
          {task.title}
        </button>
        {isRecentlyUploaded(task) && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-cta/20 px-1.5 py-0.5 font-mono-arena text-[10px] font-semibold uppercase tracking-wider text-cta"
            title="Uploaded within the last 30 hours"
          >
            ✨ new
          </span>
        )}
        {isWebProjectTask(task) && (
          <span className="inline-flex shrink-0 text-link" title="Web app task" aria-label="Web app task">
            <IconBrowser className="text-lg" />
          </span>
        )}
      </h2>

      <div className="mt-7">
        <FileTypeChips types={task.deliverable_types} />
      </div>

      {doneHarnesses.size > 0 && (
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <span className="mr-1 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">Harnesses evaluated</span>
          {harnesses.filter((h) => doneHarnesses.has(h.key)).map((h) => (
            <span key={h.key} className="inline-flex items-center gap-1 rounded-full bg-good/15 px-1.5 py-0.5 text-[10px] text-good">
              <HarnessAvatar harnessKey={h.key} name={h.name} size={14} />
              {h.name}
            </span>
          ))}
        </div>
      )}

      {doneCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <span className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">Model used</span>
          <ModelTags runs={[...everDone.values()]} />
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-end justify-between gap-5 border-t border-line pt-6">
        <p className="text-xs text-ink-3">
          {/* Failures are Battle Log's domain, not this card's  -  this only ever
              describes what actually succeeded, never how many errored. */}
          {state === 'none' && 'No runs recorded yet'}
          {state === 'queued' && 'Battle queued…'}
          {state === 'running' && 'Battle in progress…'}
          {(state === 'done' || state === 'error') &&
            (doneCount > 0
              ? `${fileCount} deliverables each`
              : 'No successful runs yet')}
          {hasRecorded && <span className="ml-2 text-good">· real recorded run</span>}
          <span className="mx-2 text-line-strong">·</span>
          {signedIn ? (judged ? <span className="text-good">Judged by you</span> : 'Not judged by you yet') : 'Sign in to judge'}
          <span className="mx-2 text-line-strong">·</span>
          {hasJudgeVerdict ? 'Artificial Analysis AI judge verdict available' : 'Artificial Analysis AI judge coming soon'}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {state === 'none' && (
            <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={onBattle}>
              {busy ? 'Running…' : 'Start battle'}
            </button>
          )}
          {state === 'running' && (
            <button type="button" className="btn-secondary text-sm" disabled>
              Running…
            </button>
          )}
          {state === 'queued' && (
            <button type="button" className="btn-secondary text-sm" disabled>
              Queued…
            </button>
          )}
          {(state === 'done' || state === 'error') && (
            <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={onRegenerate}>
              {busy ? 'Running…' : 'Run with another model'}
            </button>
          )}
          {hasActiveRuns && doneHarnesses.size >= 2 && (
            <button
              type="button"
              className="btn-cta text-sm"
              disabled
              title="Wait for every run on this task to finish before judging."
            >
              Judge when complete
            </button>
          )}
          {(canJudge || canAttemptJudge) && (
            <button type="button" className="btn-cta text-sm" onClick={onJudge}>
              {judged ? 'Review' : 'Judge'}
            </button>
          )}
        </div>
      </div>
      {doneCount > 0 && !canJudge && (
        <p className="mt-2 text-xs text-ink-3">
          {hasActiveRuns
            ? 'Wait for every run on this task to finish before judging.'
            : 'Needs two harnesses on the same model before it can be judged. Run another harness to compare against.'}
        </p>
      )}
      {notice && <p className="mt-2 text-xs text-warn">{notice}</p>}
      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs">
          <span className="font-mono-arena uppercase tracking-wider text-ink-3">Admin</span>
          {runs?.length > 0 && (
            <button type="button" className="text-bad hover:underline" onClick={onDeleteResults}>
              Delete results
            </button>
          )}
          {task.results_deleted && (
            <button type="button" className="text-link" onClick={onRestore}>
              Restore deleted results
            </button>
          )}
          <button type="button" className="text-bad hover:underline" onClick={onDeleteTask}>
            Delete task
          </button>
        </div>
      )}
    </div>
  )
}

const STATS_REFRESH_MS = 30_000
const TASKS_PER_PAGE = 6
const RECENT_UPLOAD_WINDOW_MS = 30 * 60 * 60 * 1000

function isRecentlyUploaded(task) {
  const uploadedAt = new Date(task.imported_at || 0).getTime()
  return uploadedAt > 0 && Date.now() - uploadedAt <= RECENT_UPLOAD_WINDOW_MS
}

function overviewFromRows(rows) {
  const runsByTask = {}
  const historyByTask = {}
  const judgedTaskIds = []
  for (const row of rows) {
    runsByTask[row.task_id] = row.runs
    historyByTask[row.task_id] = row.history
    if (row.compare?.revealed) judgedTaskIds.push(row.task_id)
  }
  return { runsByTask, historyByTask, judgedTaskIds }
}

function buildEvaluatePageData(tasks, overviewRows) {
  const { runsByTask, historyByTask, judgedTaskIds } = overviewFromRows(overviewRows)
  return {
    tasks,
    hasMoreTasks: tasks.length === TASKS_PER_PAGE,
    runsByTask,
    historyByTask,
    judgedTaskIds,
  }
}

export default function Evaluate({ group, onGroupChange }) {
  const { user, isAdminMode } = useAuth()
  const isAdmin = isAdminMode
  const navigate = useNavigate()
  // `category` itself always starts at '' (its own useState below)  -  safe
  // to use that literal here rather than reordering declarations just to
  // read it a few lines early.
  const [tasks, setTasks] = useState([])
  const [hasMoreTasks, setHasMoreTasks] = useState(false)
  const [categories, setCategories] = useState([])
  const [groups, setGroups] = useState([])
  const [category, setCategory] = useState('')
  const [harnesses, setHarnesses] = useState([])
  const [runsByTask, setRunsByTask] = useState({})
  const [historyByTask, setHistoryByTask] = useState({})
  const [judgedTasks, setJudgedTasks] = useState(() => new Set())
  const [stats, setStats] = useState(null)
  const [busyTask, setBusyTask] = useState(null)
  const [error, setError] = useState('')
  const [activeRunMessage, setActiveRunMessage] = useState('')
  const [insufficientResults, setInsufficientResults] = useState(false)
  const [profiles, setProfiles] = useState([])
  const [noticeByTask, setNoticeByTask] = useState({})
  const [pendingAction, setPendingAction] = useState(null) // fn to run once signed in
  const [promptTask, setPromptTask] = useState(null)
  // { taskId, force } while the model picker is open for that task.
  const [picking, setPicking] = useState(null)
  // { taskId, groups } while the judge run-picker is open  -  only needed
  // when a task has more than one judgeableGroups() entry (see judge()).
  const [judgePicking, setJudgePicking] = useState(null)
  const [page, setPage] = useState(1)

  // Latest task list and runs, readable from below without making them
  // effect dependencies (which would tear down and restart timers constantly).
  const tasksRef = useRef([])
  tasksRef.current = tasks
  const runsByTaskRef = useRef(runsByTask)
  runsByTaskRef.current = runsByTask

  useEffect(() => {
    api.listConfigs().then(setProfiles).catch(() => {})
  }, [])

  // Category options depend on the selected group; a category from another
  // group would filter to nothing, so it's dropped rather than left stale.
  useEffect(() => {
    api
      .listCategories(group || undefined)
      .then((cats) => {
        setCategories(cats)
        setCategory((cur) => (cur && !cats.includes(cur) ? '' : cur))
      })
      .catch(() => {})
  }, [group])

  useEffect(() => {
    api.listGroups().then(setGroups).catch(() => {})
    api
      .listHarnesses()
      .then((list) => {
        setHarnesses(list)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const refreshStats = () => api.stats().then(setStats).catch(() => {})
    refreshStats()
    const timer = window.setInterval(refreshStats, STATS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  const applyEvaluatePage = useCallback((pageData) => {
    setTasks(pageData.tasks)
    setHasMoreTasks(pageData.hasMoreTasks)
    setRunsByTask(pageData.runsByTask)
    setHistoryByTask(pageData.historyByTask)
    setJudgedTasks(new Set(pageData.judgedTaskIds))
  }, [])

  const fetchEvaluatePage = useCallback(
    async (pageNum) => {
      const result = await api.listTasks({
        category: category || undefined,
        group: group || undefined,
        includeDeleted: isAdmin,
        page: pageNum,
        limit: TASKS_PER_PAGE,
      })
      const list = Array.isArray(result) ? result : result.items ?? result.tasks ?? []
      return list.length
        ? buildEvaluatePageData(list, await api.runsOverview(list.map((t) => t.id_aa)))
        : { tasks: [], hasMoreTasks: false, runsByTask: {}, historyByTask: {}, judgedTaskIds: [] }
    },
    [category, group, isAdmin]
  )

  const evaluateScopeKey = useMemo(
    () => `${category}:${group}:${isAdmin}`,
    [category, group, isAdmin]
  )

  const hasNextEvaluatePage = useCallback((_pageNum, data) => data.hasMoreTasks, [])

  const reportFetchError = useCallback((error) => {
    setError(error?.message ?? 'Failed to load tasks')
  }, [])

  const { loading: tasksLoading, refreshCurrentPage: refreshEvaluatePage } = useAdjacentPagePrefetch({
    page,
    scopeKey: evaluateScopeKey,
    fetchPage: fetchEvaluatePage,
    applyPage: applyEvaluatePage,
    hasNextPage: hasNextEvaluatePage,
    onError: reportFetchError,
  })

  const reloadEvaluatePage = useCallback(async () => {
    const pageData = await refreshEvaluatePage()
    return pageData
  }, [refreshEvaluatePage])

  const refreshTask = useCallback(async (taskId) => {
    const [runs, history] = await Promise.all([
      api.listRunsForTask(taskId),
      api.listRunHistoryForTask(taskId).catch(() => []),
    ])
    const providerConfigId = resolveEverDoneProviderConfigId(runs, history)
    const cmp = await api.compare(taskId, providerConfigId)
    setRunsByTask((prev) => ({ ...prev, [taskId]: runs }))
    setHistoryByTask((prev) => ({ ...prev, [taskId]: history }))
    setJudgedTasks((prev) => {
      const next = new Set(prev)
      if (cmp.revealed) next.add(taskId)
      else next.delete(taskId)
      return next
    })
    return runs
  }, [])

  // One request for every task's runs+history+compare instead of one
  // to three requests PER task  -  this used to call refreshTask() (three
  // separate requests) once for every task on the list, so a page with 50
  // tasks fired up to ~150 requests just to load. Deliberately separate
  // from refreshTask itself: that one's still used for a single task after
  // a mutation (regenerate, restore) and for polling only whichever few
  // tasks currently have something in flight  -  neither of those is the
  // N+1 pattern this fixes, and both need to reflect one task's fresh
  // state right away rather than waiting on a full-list refetch.
  // Shared by the initial bulk load below AND the in-flight poll further
  // down  -  both just need "apply these overview rows to state", not two
  // copies of the same merge logic.
  const applyOverviewRows = useCallback((rows) => {
    const { runsByTask: nextRuns, historyByTask: nextHistory } = overviewFromRows(rows)
    // Merge, don't replace  -  polling only requests in-flight task ids, so a
    // full replace would wipe every other card back to "No runs recorded yet".
    setRunsByTask((prev) => ({ ...prev, ...nextRuns }))
    setHistoryByTask((prev) => ({ ...prev, ...nextHistory }))
    setJudgedTasks((prev) => {
      const next = new Set(prev)
      for (const row of rows) {
        if (row.compare?.revealed) next.add(row.task_id)
        else next.delete(row.task_id)
      }
      return next
    })
  }, [])

  // Poll only while something is actually in flight, and not so often that
  // a page full of tasks turns into a request storm. This used to call
  // refreshTask() (three separate requests: runs, history, compare) once
  // per in-flight task on every tick  -  with several tasks running at
  // once, that's the exact N+1 pattern the bulk runsOverview effect above
  // was already built to avoid, just reintroduced here on a 4s timer. One
  // bulk call for every in-flight task together, same as the initial load.
  useEffect(() => {
    const timer = setInterval(() => {
      const inFlightIds = tasksRef.current
        .filter((t) =>
          runsByTaskRef.current[t.id_aa]?.some((r) => r.status === 'pending' || r.status === 'running')
        )
        .map((t) => t.id_aa)
      if (!inFlightIds.length) return
      api.runsOverview(inFlightIds).then(applyOverviewRows).catch(() => {})
    }, 4000)
    return () => clearInterval(timer)
  }, [applyOverviewRows])

  // Battles and judging both use up real (or free-tier) API capacity, so
  // both require a signed-in account, not just score submission. The
  // requested action re-runs automatically once sign-in succeeds.
  function requireAuth(action) {
    if (getUserToken()) {
      action()
      return
    }
    setPendingAction(() => action)
  }

  /** Harnesses this battle would actually run. A battle needs at least two:
   *  one output has nothing to be compared against (the backend enforces
   *  the same rule, this just fails faster and more clearly). */
  function runnableHarnesses() {
    return harnesses.filter((harness) => harness.enabled).map((harness) => harness.key)
  }

  /** Step 1 of running: validate, then open the model picker. The actual
   *  run happens in `battle()` once a profile is chosen. */
  function openModelPicker(taskId, force) {
    const available = harnesses.filter((harness) => harness.enabled)
    if (available.length < 2) {
      setError('At least 2 runnable harnesses are needed for a comparison.')
      return
    }
    setError('')
    setPicking({ taskId, force })
  }

  // OnDemand's model is resolved server-side from the chosen free profile's
  // admin-set mapping now  -  no ondemandModelId is picked or sent from here
  // any more (api.triggerRun's own parameter is deprecated but kept for old
  // clients; passing null is deliberate).
  async function battle(taskId, force, profileId, selectedHarnessKeys) {
    const runnableSelection = (selectedHarnessKeys ?? runnableHarnesses()).filter(
      (key) => harnesses.find((harness) => harness.key === key)?.enabled
    )
    if (runnableSelection.length < 2) {
      setError('Select at least 2 harnesses. A single harness has nothing to compare against.')
      return
    }
    setBusyTask(taskId)
    setError('')
    setNoticeByTask((prev) => ({ ...prev, [taskId]: '' }))
    try {
      await api.triggerRun(taskId, runnableSelection, force, profileId ?? null)
      api.stats().then(setStats).catch(() => {})
      navigate('/battles', { state: { submittedTaskId: taskId } })
    } catch (err) {
      if (/still in progress|only run 2 tasks at a time/i.test(err.message)) setActiveRunMessage(err.message)
      else setError(err.message)
    } finally {
      setBusyTask(null)
    }
  }

  function openJudge(taskId, profileId) {
    navigate(`/eval/${taskId}${profileId != null ? `?model=${profileId}` : ''}`, { state: { from: '/evaluate' } })
  }

  function judge(taskId) {
    if (runsByTask[taskId]?.some((run) => run.status === 'pending' || run.status === 'running')) {
      setActiveRunMessage('Wait for every run on this task to finish before judging.')
      return
    }
    const judgeable = judgeableGroups(runsByTask[taskId], historyByTask[taskId])
    if (!judgeable.length) {
      setInsufficientResults(true)
      return
    }
    // Regenerate no longer dedupes runs, so a task can have several
    // distinct groups (different model profiles run at different times)  -
    // go straight in when there's only one thing at all, same as before;
    // ask which one otherwise instead of silently guessing. This lists
    // EVERY group (comparisonGroups), not just the >=2-harness ones
    // judgeableGroups filters to  -  a single-harness group has nothing to
    // blind-compare, but its one output is still worth being able to open
    // (JudgeRunPickerModal opens it as "View results" instead of "Judge").
    const groups = comparisonGroups(runsByTask[taskId], historyByTask[taskId])
    if (groups.length <= 1) {
      openJudge(taskId, groups[0]?.profileId ?? null)
      return
    }
    setJudgePicking({ taskId, groups })
  }

  async function deleteResults(task) {
    if (!window.confirm(`Delete every run, deliverable, score, and AI judge verdict for “${task.title}”? This cannot be undone.`)) return
    try {
      await api.deleteTaskResults(task.id_aa)
      await Promise.all([reloadEvaluatePage(), api.stats().then(setStats)])
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteTask(task) {
    if (!window.confirm(`Delete “${task.title}” and all of its runs, deliverables, scores, and AI judge data? This cannot be undone.`)) return
    try {
      await api.deleteTask(task.id_aa)
      await Promise.all([reloadEvaluatePage(), api.stats().then(setStats)])
    } catch (err) {
      setError(err.message)
    }
  }

  async function restore(task) {
    try {
      await api.restoreTask(task.id_aa)
      await Promise.all([reloadEvaluatePage(), api.stats().then(setStats)])
      await refreshTask(task.id_aa)
    } catch (err) {
      setError(err.message)
    }
  }

  // Judging must only ever surface complete outputs. Active work is owned by
  // Battle Log, where the user can follow per-harness delivery progress.
  const visibleTasks = tasks.filter((task) => {
    const runs = runsByTask[task.id_aa]
    if (runs?.some((run) => run.status === 'pending' || run.status === 'running')) return false
    return true
  })

  // Filter changes (or the visible set shrinking, e.g. a task getting
  // deleted) can leave `page` past the new last page  -  reset/clamp
  // rather than showing an empty page with real results one click back.
  useEffect(() => {
    setPage(1)
  }, [group, category])

  const pageTasks = visibleTasks
  const pageCount = hasMoreTasks ? page + 1 : Math.max(1, page)
  const showPagination = page > 1 || hasMoreTasks

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Evaluation engine"
        title="Agents doing the work. You judge it."
      >
        <p>
          Tasks come from datasets uploaded to this arena - whether created in Artificial Analysis or built from your own
          workflow. Each one is a real, multi-deliverable assignment and is run by every selected harness on the same
          model, in its own isolated workspace. Review the deliverables blind,
          score them, and only then see which harness produced what.
        </p>
      </PageHeader>

      {stats && (
        <StatsLine
          items={[
            { value: stats.tasks, label: 'tasks' },
            { value: stats.harnesses, label: 'harnesses', badge: 'more coming soon' },
            { value: stats.recorded_runs, label: 'recorded runs' },
          ]}
        />
      )}

      <Notice icon="⚖">Outputs are anonymized. Identities reveal only after you score every one.</Notice>

      <div className="filter-toolbar filter-toolbar-evaluate">
        {groups.length > 1 && (
          <div className="filter-field">
            <span className="filter-label">Group</span>
            <ChoiceDropdown compact className="min-w-40" value={group} onChange={onGroupChange} placeholder="All" options={[{ id: '', label: 'All' }, ...groups.map((item) => ({ id: item, label: item }))]} />
          </div>
        )}
        <div className="filter-field">
          <span className="filter-label">Category</span>
          <ChoiceDropdown compact className="min-w-48" value={category} onChange={setCategory} placeholder="All" options={[{ id: '', label: 'All' }, ...categories.map((item) => ({ id: item, label: item }))]} />
        </div>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {tasksLoading ? (
        <LoadingState label="Loading tasks and results…" />
      ) : (
      <div className="grid gap-7 xl:grid-cols-2">
        {pageTasks.map((task) => (
          <TaskCard
            key={task.id_aa}
            task={task}
            runs={runsByTask[task.id_aa]}
            history={historyByTask[task.id_aa]}
            harnesses={harnesses}
            signedIn={Boolean(user)}
            isAdmin={isAdmin}
            judged={judgedTasks.has(task.id_aa)}
            hasJudgeVerdict={task.has_judge_verdict}
            busy={busyTask === task.id_aa}
            notice={noticeByTask[task.id_aa]}
            onBattle={() => requireAuth(() => openModelPicker(task.id_aa, false))}
            onRegenerate={() => requireAuth(() => openModelPicker(task.id_aa, true))}
            onJudge={() => requireAuth(() => judge(task.id_aa))}
            onDeleteResults={() => deleteResults(task)}
            onDeleteTask={() => deleteTask(task)}
            onRestore={() => restore(task)}
            onOpenPrompt={() => setPromptTask(task)}
          />
        ))}
        {visibleTasks.length === 0 &&
          (stats && stats.tasks === 0 ? (
            <div className="card space-y-3 p-6 text-center">
              <p className="font-display text-lg font-semibold">No dataset loaded yet</p>
              <p className="text-sm text-ink-2">
                Upload a benchmark dataset to get tasks into the arena.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link to="/benchmark" className="btn-cta text-sm">
                  Upload dataset
                </Link>
              </div>
            </div>
          ) : tasks.length > 0 ? (
            <Notice icon="⏳">Active runs are generating deliverables in Battle Log. Completed outputs will appear here when ready to judge.</Notice>
          ) : (
            <EmptyState>No tasks match these filters.</EmptyState>
          ))}
      </div>
      )}
      {!tasksLoading && showPagination && (
        <Pagination page={page} pageCount={pageCount} onChange={setPage} />
      )}

      {picking && (
        <ModelPickerModal
          profiles={profiles}
          runs={runsByTask[picking.taskId]}
          harnesses={harnesses.filter((harness) => harness.enabled)}
          initialHarnessKeys={runnableHarnesses()}
          busy={busyTask === picking.taskId}
          onClose={() => setPicking(null)}
          onSelect={(profileId, selectedHarnessKeys) => {
            const { taskId, force } = picking
            setPicking(null)
            battle(taskId, force, profileId, selectedHarnessKeys)
          }}
        />
      )}

      {activeRunMessage && <ActiveRunToast message={activeRunMessage} onClose={() => setActiveRunMessage('')} />}
      {insufficientResults && <InsufficientResultsToast onClose={() => setInsufficientResults(false)} />}

      {judgePicking && (
        <JudgeRunPickerModal
          taskId={judgePicking.taskId}
          groups={judgePicking.groups}
          harnessesByKey={Object.fromEntries(harnesses.map((h) => [h.key, h]))}
          onClose={() => setJudgePicking(null)}
          onSelect={(profileId) => {
            const { taskId } = judgePicking
            setJudgePicking(null)
            openJudge(taskId, profileId)
          }}
        />
      )}

      {promptTask && <TaskPromptModal task={promptTask} onClose={() => setPromptTask(null)} />}

      {pendingAction && (
        <AuthModal
          reason="Sign in to run or judge a battle. It is attributed to your account."
          onClose={() => setPendingAction(null)}
          onSuccess={() => {
            const action = pendingAction
            setPendingAction(null)
            action?.()
          }}
        />
      )}
    </div>
  )
}

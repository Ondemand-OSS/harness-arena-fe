import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { api, getUserToken } from '../api.js'
import { useAuth } from '../auth.jsx'
import AuthModal from '../components/AuthModal.jsx'
import ReferenceFileModal from '../components/ReferenceFileModal.jsx'
import TaskPromptModal from '../components/TaskPromptModal.jsx'
import { EmptyState, HarnessAvatar, LoadingState, PageHeader, Tag } from '../components/ui.jsx'
import { IconBrowser, IconChevron, IconClose, IconPaperclip } from '../components/icons.jsx'
import RevalidatingBadge from '../components/RevalidatingBadge.jsx'
import { readCache, writeCache } from '../lib/pageCache.js'
import { isWebProjectTask } from '../lib/webProject.js'

// Module-scoped  -  survives navigating away and back within the same SPA
// session (see lib/pageCache.js). No filters on this page, so a plain
// fixed key is enough (unlike Evaluate's, which varies by category/group).
const TASKS_CACHE_KEY = 'benchmark:tasks'
const RUNS_CACHE_KEY = 'benchmark:runsByTask'
const REFERENCE_FILES_CACHE_KEY = 'benchmark:referenceFilesByTask'

// Same "no reference material" tokens the backend's
// taxonomy.parse_reference_filenames treats as equivalent to blank (see
// backend/app/taxonomy.py)  -  a task's `reference_files` cell holding one of
// these must not be shown or treated as a filename to attach.
const NO_REFERENCE_TOKENS = new Set(['na', 'n/a', 'none', '-'])

function parseReferenceFilenames(referenceFiles) {
  return (referenceFiles || '')
    .split(',')
    .map((s) => s.trim())
    .filter((name) => name && !NO_REFERENCE_TOKENS.has(name.toLowerCase()))
}

const STATE_LABEL = {
  queued: 'Queued',
  running: 'Running…',
  ready: 'Ready to judge',
  judged: 'Judged by you',
}
const STATE_TONE = {
  queued: 'text-ink-3',
  running: 'text-warn',
  ready: 'text-good',
  judged: 'text-good',
}

// How often the page polls a batch it's actively watching. Short enough to
// feel live while someone's on this page waiting; see Battle Log for the
// much longer interval used to check on batches in the background.
const ACTIVE_POLL_MS = 4000
const RECENT_UPLOAD_WINDOW_MS = 26 * 60 * 60 * 1000

function UploadErrorToast({ message, onClose }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [onClose])

  return createPortal(
    <div role="alert" className="fixed bottom-5 left-1/2 z-[100] flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-bad/30 bg-floating px-4 py-3 text-sm font-medium text-bad shadow-xl">
      <span className="text-base" aria-hidden="true">!</span>
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" className="text-ink-3 hover:text-ink" onClick={onClose} aria-label="Dismiss">×</button>
    </div>,
    document.body
  )
}

/** Upload a dataset, pick harnesses, and submit tasks for evaluation.
 *  Deliberately its own page rather than a corner of Setup: this is a
 *  workflow (load → choose → run → watch), not a configuration toggle. */
export default function Benchmark() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState(() => readCache(TASKS_CACHE_KEY) ?? [])
  const [tasksLoading, setTasksLoading] = useState(() => readCache(TASKS_CACHE_KEY) === undefined)
  const [harnesses, setHarnesses] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [selectedHarnesses, setSelectedHarnesses] = useState([])
  const [harnessNotice, setHarnessNotice] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [selectedTasks, setSelectedTasks] = useState(new Set())
  const [taskSelectionNotice, setTaskSelectionNotice] = useState('')
  const [promptTask, setPromptTask] = useState(null)
  const [runsByTask, setRunsByTask] = useState(() => readCache(RUNS_CACHE_KEY) ?? {})
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [uploadErrorToast, setUploadErrorToast] = useState('')
  const [batch, setBatch] = useState(null)
  // True the instant the button is clicked, not just while batch?.status
  // is 'running'  -  that only ever becomes true once api.submitBatch's
  // whole round trip (validation, quota/active-run checks, creating a run
  // document per task×harness) has already come back, so without this the
  // button visibly did nothing for however long that took.
  const [submitting, setSubmitting] = useState(false)
  // Exactly the task ids the most recent upload/import THIS session
  // actually just created  -  NOT dataset_version, which gets re-stamped on
  // every row an import touches (new or already-existing), so comparing
  // against it badged literally every task as "new" on a second import of
  // the same file.
  const [newTaskIds, setNewTaskIds] = useState(new Set())
  const [showAuth, setShowAuth] = useState(false)
  const [pendingSubmit, setPendingSubmit] = useState(false)
  const pollRef = useRef(null)
  const taskSelectionNoticeTimerRef = useRef(null)
  const modelMenuRef = useRef(null)

  useEffect(
    () => () => {
      if (taskSelectionNoticeTimerRef.current) window.clearTimeout(taskSelectionNoticeTimerRef.current)
    },
    []
  )
  // What's actually attached (real bytes) per task  -  keyed by task id_aa,
  // each value the list from GET .../reference-files. Only fetched for
  // tasks whose `reference_files` text names something in the first place;
  // most tasks have none. See ReferenceFileControl below.
  const [referenceFilesByTask, setReferenceFilesByTask] = useState(() => readCache(REFERENCE_FILES_CACHE_KEY) ?? {})
  // True only while the initial page-load task list is being silently
  // refreshed after rendering instantly from a cache hit  -  see
  // RevalidatingBadge. Not tied to refreshTasks() itself (also called
  // after an upload/import), so those don't toggle it on and off too.
  const [revalidating, setRevalidating] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) setShowAuth(true)
  }, [authLoading, user])

  function refreshTasks() {
    setTasksLoading(true)
    return api
      .listTasks()
      .then((t) => {
        writeCache(TASKS_CACHE_KEY, t)
        setTasks(t)
        return t
      })
      .catch(() => [])
      .finally(() => setTasksLoading(false))
  }

  useEffect(() => {
    if (readCache(TASKS_CACHE_KEY) !== undefined) setRevalidating(true)
    refreshTasks().finally(() => setRevalidating(false))
    api
      .listHarnesses()
      .then((list) => {
        setHarnesses(list)
      })
      .catch(() => {})
    api
      .listConfigs()
      .then((list) => {
        setProfiles(list)
        setSelectedProfileId(String(list[0]?.id ?? ''))
      })
      .catch(() => {})
    return () => clearTimeout(pollRef.current)
  }, [])

  useEffect(() => {
    if (!user?.has_ondemand_api_key) {
      setSelectedHarnesses((selected) => selected.filter((key) => key !== 'ondemand'))
    }
  }, [user?.has_ondemand_api_key, harnesses])

  useEffect(() => {
    function closeModelMenu(event) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) setModelMenuOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setModelMenuOpen(false)
    }
    document.addEventListener('mousedown', closeModelMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', closeModelMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // One request for every task's current runs instead of one request PER
  // task, just to answer "does this already have results?" for the "has
  // results" badge below.
  useEffect(() => {
    let cancelled = false
    api
      .runsOverview(tasks.map((t) => t.id_aa))
      .then((rows) => {
        if (cancelled) return
        const update = Object.fromEntries(rows.map((row) => [row.task_id, row.runs]))
        setRunsByTask((prev) => {
          const next = { ...prev, ...update }
          writeCache(RUNS_CACHE_KEY, next)
          return next
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tasks])

  function refreshReferenceFiles(taskId) {
    api
      .listReferenceFiles(taskId)
      .then((files) =>
        setReferenceFilesByTask((prev) => {
          const next = { ...prev, [taskId]: files }
          writeCache(REFERENCE_FILES_CACHE_KEY, next)
          return next
        })
      )
      .catch(() => {})
  }

  // Only tasks that actually name reference material bother fetching this  -
  // most don't. No bulk endpoint exists for this yet (unlike runsOverview
  // above), but the subset naming reference_files is typically small.
  useEffect(() => {
    let cancelled = false
    const named = tasks.filter((t) => parseReferenceFilenames(t.reference_files).length > 0)
    Promise.all(
      named.map((t) =>
        api
          .listReferenceFiles(t.id_aa)
          .then((files) => [t.id_aa, files])
          .catch(() => [t.id_aa, []])
      )
    ).then((pairs) => {
      if (cancelled) return
      setReferenceFilesByTask((prev) => {
        const next = { ...prev, ...Object.fromEntries(pairs) }
        writeCache(REFERENCE_FILES_CACHE_KEY, next)
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [tasks])

  async function upload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus(`Uploading ${file.name}…`)
    setError('')
    setUploadErrorToast('')
    try {
      const res = await api.uploadDataset(file)
      await refreshTasks()
      setNewTaskIds(new Set(res.new_task_ids))
      setStatus(`Loaded ${res.imported} tasks (dataset ${res.dataset_version}).`)
    } catch (err) {
      setStatus('')
      setError(err.message)
      setUploadErrorToast(err.message)
    }
    e.target.value = ''
  }

  // Most recently (re)imported first, so a freshly uploaded/restored task
  // doesn't get buried alphabetically among everything already loaded.
  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => new Date(b.imported_at || 0).getTime() - new Date(a.imported_at || 0).getTime()),
    [tasks]
  )
  const taskGroups = useMemo(
    () => [...new Set(tasks.map((task) => task.group).filter(Boolean))].sort(),
    [tasks]
  )
  const visibleTasks = useMemo(
    () => (groupFilter ? sortedTasks.filter((task) => task.group === groupFilter) : sortedTasks),
    [groupFilter, sortedTasks]
  )
  const recentUploadIds = useMemo(
    () =>
      new Set(
        tasks
          .filter((task) => {
            const uploadedAt = new Date(task.imported_at || 0).getTime()
            return uploadedAt > 0 && Date.now() - uploadedAt <= RECENT_UPLOAD_WINDOW_MS
          })
          .map((task) => task.id_aa)
      ),
    [tasks]
  )

  function toggleTask(id) {
    if (!selectedTasks.has(id) && selectedTasks.size >= 1) {
      showTaskSelectionNotice('Only 1 task can be run at a time.')
      return
    }
    setSelectedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function showTaskSelectionNotice(message) {
    setTaskSelectionNotice(message)
    if (taskSelectionNoticeTimerRef.current) window.clearTimeout(taskSelectionNoticeTimerRef.current)
    taskSelectionNoticeTimerRef.current = window.setTimeout(() => setTaskSelectionNotice(''), 4000)
  }

  function toggleHarness(key) {
    setSelectedHarnesses((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  function pollBatch(id) {
    api
      .getBatch(id)
      .then((b) => {
        setBatch(b)
        if (b.status === 'running') {
          pollRef.current = setTimeout(() => pollBatch(id), ACTIVE_POLL_MS)
        } else {
          refreshTasks()
        }
      })
      .catch(() => {})
  }

  async function submitForEvaluation() {
    if (!getUserToken()) {
      setPendingSubmit(true)
      setShowAuth(true)
      return
    }
    const ids = [...selectedTasks]
    if (!ids.length) return setError('Select at least one task.')
    if (selectedHarnesses.length < 2)
      return setError('Select at least 2 harnesses. A single harness has nothing to compare against.')
    if (!selectedProfileId) return setError('Select a model profile for this benchmark.')
    if (selectedHarnesses.includes('ondemand')) {
      if (!user?.has_ondemand_api_key) return setError('Set your OnDemand API key in Setup before running OnDemand.')
    }

    setError('')
    setStatus('')
    setSubmitting(true)
    try {
      const created = await api.submitBatch(ids, selectedHarnesses, Number(selectedProfileId))
      setBatch(created)
      navigate('/battles', { state: { submittedTaskIds: ids } })
    } catch (err) {
      if (/only run 2 tasks at a time/i.test(err.message)) showTaskSelectionNotice(err.message)
      else setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const hasResults = (id) => (runsByTask[id] ?? []).some((r) => r.status === 'done')
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="New benchmark" title="Benchmark a new task" aside={<RevalidatingBadge show={revalidating} />}>
        <p>
          Create a dataset in Artificial Analysis or bring your own Excel dataset. Then choose which harnesses
          compete and submit the tasks for evaluation. Each finished task becomes gradeable immediately.
        </p>
      </PageHeader>

      <div className="card space-y-4 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Load a dataset</h2>
          <span className="font-mono-arena text-xs text-ink-3">{tasks.length} tasks loaded</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-floating p-4">
            <p className="font-medium text-ink">Create a dataset with Artificial Analysis</p>
            <a
              href="https://artificialanalysis.ai/optima"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-link"
            >
              Open Artificial Analysis ↗
            </a>
          </div>
          <div className="rounded-lg border border-line bg-floating p-4">
            <p className="font-medium text-ink">Bring your own dataset</p>
            <p className="mt-1 text-sm text-ink-2">Fill in the Excel template with one task per row, then upload it. A task can list at most 20 expected deliverables.</p>
            <div className="mt-3">
              <a href={api.datasetTemplateUrl()} className="text-sm text-link" download>
                Download Excel template ↓
              </a>
            </div>
          </div>
        </div>
        <label className="btn-cta inline-flex w-fit cursor-pointer text-sm">
          Upload dataset (.xlsx)
          <input type="file" accept=".xlsx" className="hidden" onChange={upload} />
        </label>
        {status && <p className="text-sm text-good">{status}</p>}
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>

      {uploadErrorToast && <UploadErrorToast message={uploadErrorToast} onClose={() => setUploadErrorToast('')} />}

      <div className="card space-y-3 p-5">
        <h2 className="font-display text-lg font-semibold">Choose harnesses</h2>
        <div className="flex flex-wrap gap-2">
          {harnesses.map((h) => {
            const on = selectedHarnesses.includes(h.key)
            const ondemandBlocked = h.key === 'ondemand' && !user?.has_ondemand_api_key
            const unavailable = !h.enabled || ondemandBlocked
            return (
              <button
                key={h.key}
                type="button"
                onClick={() => {
                  if (ondemandBlocked) {
                    setHarnessNotice('Set your OnDemand API key in Setup before selecting OnDemand.')
                    return
                  }
                  if (h.enabled) toggleHarness(h.key)
                }}
                aria-pressed={on}
                aria-disabled={unavailable}
                title={ondemandBlocked ? 'Set your OnDemand API key in Setup to unlock this harness.' : h.enabled ? h.tagline : 'Not yet integrated. Cannot be run.'}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                  unavailable ? 'cursor-not-allowed' : 'cursor-pointer'
                } ${on ? 'border-transparent bg-cta text-on-cta' : 'border-line-strong bg-floating text-ink-2'}`}
              >
                <span aria-hidden="true">{on ? '✓' : '+'}</span>
                <HarnessAvatar harnessKey={h.key} name={h.name} size={18} />
                {h.name}
                {!h.enabled && <span className="text-[10px] uppercase">soon</span>}
              </button>
            )
          })}
        </div>
        {(harnessNotice || !user?.has_ondemand_api_key) && (
          <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink-2" role="status">
            {harnessNotice || 'Set your OnDemand API key in Setup before selecting OnDemand.'} <Link to="/setup" className="text-link">Open Setup</Link>
          </p>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Select tasks to run</h2>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-ink-3">{visibleTasks.length} of {tasks.length}</span>
            <button type="button" className="text-link" onClick={() => setSelectedTasks(new Set())}>
              clear
            </button>
          </div>
        </div>

        {taskGroups.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filter tasks by group">
            <button
              type="button"
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${!groupFilter ? 'border-cta bg-cta text-on-cta' : 'border-line-strong bg-floating text-ink-2'}`}
              aria-pressed={!groupFilter}
              onClick={() => setGroupFilter('')}
            >
              All groups
            </button>
            {taskGroups.map((taskGroup) => (
              <button
                key={taskGroup}
                type="button"
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${groupFilter === taskGroup ? 'border-cta bg-cta text-on-cta' : 'border-line-strong bg-floating text-ink-2'}`}
                aria-pressed={groupFilter === taskGroup}
                onClick={() => setGroupFilter(taskGroup)}
              >
                {taskGroup}
              </button>
            ))}
          </div>
        )}

        {tasksLoading ? (
          <LoadingState label="Loading…" />
        ) : tasks.length === 0 ? (
          <EmptyState>Load a dataset above to see its tasks.</EmptyState>
        ) : (
          <div className="max-h-[34rem] divide-y divide-line overflow-y-auto pr-4">
            {visibleTasks.map((t) => (
              // flex-wrap so the group tag, "has results" and the reference
              // chips drop to a second line on a phone instead of competing
              // for width with the task title.
              <label key={t.id_aa} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <input
                  type="checkbox"
                  checked={selectedTasks.has(t.id_aa)}
                  onChange={() => toggleTask(t.id_aa)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    <span className="min-w-0 truncate">
                    {t.title}
                    {(newTaskIds.has(t.id_aa) || recentUploadIds.has(t.id_aa)) && (
                      <span
                        className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-cta/20 px-1.5 py-0.5 font-mono-arena text-[10px] font-semibold uppercase tracking-wider text-cta"
                        title={newTaskIds.has(t.id_aa) ? 'Just loaded by this upload' : 'Uploaded within the last 26 hours'}
                      >
                        ✨ new
                      </span>
                    )}
                    </span>
                    {isWebProjectTask(t) && (
                      <span className="inline-flex shrink-0 text-link" title="Web app task" aria-label="Web app task">
                        <IconBrowser className="text-sm" />
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn-secondary shrink-0 px-2 py-0.5 text-[11px]"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setPromptTask(t)
                      }}
                    >
                      View task
                    </button>
                  </span>
                  <span className="mt-2 block font-mono-arena text-[10px] text-ink-3">{t.id_aa}</span>
                </span>
                <Tag>{t.group}</Tag>
                {hasResults(t.id_aa) && (
                  <span className="shrink-0 font-mono-arena text-[10px] text-good">has results</span>
                )}
                <ReferenceFileControl
                  task={t}
                  admin={Boolean(user?.is_admin)}
                  attachedFiles={referenceFilesByTask[t.id_aa]}
                  onChanged={refreshReferenceFiles}
                />
              </label>
            ))}
            {visibleTasks.length === 0 && (
              <p className="py-5 text-center text-sm text-ink-3">No tasks in this group.</p>
            )}
          </div>
        )}
      </div>

      {/* Three columns only from xl (1280px) up, not lg (1024px): at
          in-between widths the old lg:-based grid could squeeze the
          middle "N tasks selected" column down to almost nothing  -  its
          text would wrap into a narrow, visually "cut" strip  -  since
          column 1's 24rem minimum plus column 3's auto-sized buttons
          could eat most of the row well before 1280px. Column 1 is
          proportional (1.3fr, more than column 2's 1fr) rather than
          capped at a fixed rem value  -  a real profile label like "Free ·
          Deepseek V4 Flash · deepseek/deepseek-v4-flash" needs more than
          22rem to actually show, and a hard cap just clipped it with no
          ellipsis on wide screens that had the room to spare. Column 2
          keeps its own floor (12rem) so it can shrink but never vanish. */}
      <div className="card grid gap-4 p-5 xl:grid-cols-[minmax(18rem,1.3fr)_minmax(12rem,1fr)_auto] xl:items-center">
        <div className="relative z-10 min-w-0 rounded-lg border border-line bg-floating p-3 text-sm text-ink-2" ref={modelMenuRef}>
          <span className="mb-1 block font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">Model for this benchmark</span>
          {(() => {
            const selectedProfile = profiles.find((item) => String(item.id) === selectedProfileId)
            return (
              <>
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  disabled={submitting}
                  onClick={() => setModelMenuOpen((open) => !open)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-ink shadow-sm transition-colors hover:border-ink-3 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    {selectedProfile ? (
                      <>
                        <span className="flex flex-wrap items-center gap-1.5 font-medium leading-5">
                          <span>{selectedProfile.name}</span>
                          {selectedProfile.is_free && (
                            <span className="rounded-full bg-cta/15 px-2 py-0.5 font-mono-arena text-[10px] font-semibold uppercase tracking-wider text-cta">
                              Free
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block break-all font-mono-arena text-[10px] leading-4 text-ink-3">
                          {selectedProfile.model}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-3">Select a model profile</span>
                    )}
                  </span>
                  <IconChevron className={`shrink-0 text-base text-ink-3 transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {modelMenuOpen && (
                  <div className="absolute left-3 right-3 top-[calc(100%-0.75rem)] z-20 mt-2 overflow-hidden rounded-xl border border-line-strong bg-surface p-1.5 shadow-xl" role="listbox" aria-label="Model profile">
                    <div className="max-h-72 space-y-1 overflow-y-auto pr-0.5">
                      {profiles.map((profile) => {
                        const selected = String(profile.id) === selectedProfileId
                        return (
                          <button
                            key={profile.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              setSelectedProfileId(String(profile.id))
                              setModelMenuOpen(false)
                            }}
                            className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              selected ? 'bg-cta text-on-cta' : 'text-ink hover:bg-elevated'
                            }`}
                          >
                            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${selected ? 'bg-on-cta' : 'bg-ink-3/50'}`} aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold leading-5">
                                <span>{profile.name}</span>
                                {profile.is_free && (
                                  <span className={`rounded-full px-2 py-0.5 font-mono-arena text-[10px] font-semibold uppercase tracking-wider ${selected ? 'bg-on-cta/15 text-on-cta' : 'bg-cta/15 text-cta'}`}>
                                    Free
                                  </span>
                                )}
                              </span>
                              <span className={`mt-0.5 block break-all font-mono-arena text-[10px] leading-4 ${selected ? 'text-on-cta/75' : 'text-ink-3'}`}>
                                {profile.model}
                              </span>
                            </span>
                            {selected && <span className="pt-0.5 text-sm" aria-label="Selected">✓</span>}
                          </button>
                        )
                      })}
                      {profiles.length === 0 && <p className="px-3 py-4 text-sm text-ink-3">No model profiles available.</p>}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
        <div className="min-w-0 text-sm text-ink-2">
          {batch ? (
            <span className="font-mono-arena text-xs">
              {batch.completed}/{batch.total} complete
              {batch.current_task_id ? ` · running ${batch.current_task_id}` : ''}
              {batch.status === 'done' && ' · finished, ready to judge'}
              {batch.error_message && <span className="text-bad"> · {batch.error_message}</span>}
            </span>
          ) : (
            <div>
              <span>
              {selectedTasks.size} task{selectedTasks.size === 1 ? '' : 's'} × {selectedHarnesses.length} harness
              {selectedHarnesses.length === 1 ? '' : 'es'} selected.
              </span>
              <p className="mt-1 rounded bg-elevated px-2 py-1 text-xs text-ink-3">
                Note: Select at least two harnesses to run a comparison.
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 xl:justify-end">
          <button type="button" className="btn-secondary text-sm" onClick={() => navigate('/battles')}>
            View progress
          </button>
          <button
            type="button"
            className="btn-cta whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
            disabled={
              submitting ||
              selectedTasks.size === 0 ||
              selectedHarnesses.length < 2 ||
              !selectedProfileId ||
              (selectedHarnesses.includes('ondemand') && !user?.has_ondemand_api_key)
            }
            onClick={submitForEvaluation}
          >
            {submitting ? 'Submitting…' : 'Submit for evaluation'}
          </button>
        </div>
      </div>

      {batch && (
        <div className="card divide-y divide-line">
          {batch.tasks.map((t) => (
            <div key={t.task_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 truncate text-sm">{t.title}</span>
              <span className={`shrink-0 font-mono-arena text-xs ${STATE_TONE[t.state]}`}>
                {STATE_LABEL[t.state]}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-ink-3">
        Once a task finishes, judge it from{' '}
        <Link to="/evaluate" className="text-link">
          Evaluate
        </Link>{' '}
        or the{' '}
        <Link to="/battles" className="text-link">
          Battle Log
        </Link>
        .
      </p>

      {showAuth && (
        <AuthModal
          reason="Sign in to submit a benchmark. It is attributed to your account."
          onClose={() => {
            const wasSubmitting = pendingSubmit
            setPendingSubmit(false)
            setShowAuth(false)
            if (!wasSubmitting) navigate('/evaluate')
          }}
          onSuccess={() => {
            const shouldSubmit = pendingSubmit
            setPendingSubmit(false)
            setShowAuth(false)
            if (shouldSubmit) submitForEvaluation()
          }}
        />
      )}

      {taskSelectionNotice && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-warn/30 bg-floating px-4 py-3 text-sm font-medium text-warn shadow-xl"
        >
          {taskSelectionNotice}
        </div>
      )}

      {promptTask && <TaskPromptModal task={promptTask} onClose={() => setPromptTask(null)} />}
    </div>
  )
}

/** Per-task-row status/action for the real bytes behind `reference_files`
 * text  -  see backend/app/routers/tasks.py's reference-files endpoints and
 * harnesses/_reference_files.py (workdir for Claude Code/Codex,
 * session upload for OnDemand) for how a run actually uses this.
 *
 * Shows an explicit empty-state label for a task that names no reference
 * material. `onChanged` is Benchmark's refreshReferenceFiles  -  re-fetches
 * this one task's list after an upload/remove instead of a full reload. */
function ReferenceFileControl({ task, admin, attachedFiles, onChanged }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [viewingFile, setViewingFile] = useState(null)
  // Open on hover of the trigger box (or the panel itself, since moving
  // the pointer from one to the other briefly leaves both); a click also
  // toggles it so the panel stays reachable without a pointer  -  keyboard
  // focus, or a touch device where "hover" never fires.
  const [open, setOpen] = useState(false)
  const fileInputRefs = useRef({})
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function close(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const expectedNames = parseReferenceFilenames(task.reference_files)
  if (!expectedNames.length) {
    return <span className="ml-2 shrink-0 font-mono-arena text-[10px] text-ink-3">no reference files</span>
  }

  const attached = attachedFiles ?? []
  const attachedNames = new Set(attached.map((f) => f.filename))
  const missing = expectedNames.filter((n) => !attachedNames.has(n))
  const allAttached = missing.length === 0

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await api.uploadReferenceFile(task.id_aa, file)
      onChanged(task.id_aa)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(fileId) {
    setBusy(true)
    setError('')
    try {
      await api.deleteReferenceFile(task.id_aa, fileId)
      onChanged(task.id_aa)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    {/* Keep this control separate from the task checkbox. A row of chips
        here  -  one per attached/missing file, each already a filename +
        View + remove  -  used to fight the task title for width in the
        row (flex-wrapping or, later, an always-visible horizontal
        scroller). Collapsing to one compact trigger that opens a popover
        on click keeps the row's footprint constant regardless of how many
        files a task names. Click-only (no hover-open): hover made the
        popover pop open just from moving the mouse across the row on the
        way to something else. */}
    <span
      className="relative ml-2 inline-block shrink-0"
      ref={rootRef}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono-arena text-[10px] font-medium transition-colors ${
          allAttached
            ? 'border-good/25 bg-good/10 text-good hover:bg-good/15'
            : 'border-warn/30 bg-warn/10 text-warn hover:bg-warn/15'
        }`}
      >
        <IconPaperclip className="shrink-0 text-[11px]" aria-hidden="true" />
        {attached.length}/{expectedNames.length} attached
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1.5 w-72 max-w-[85vw] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
          role="menu"
        >
          <p className="border-b border-line px-3 py-2 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
            {expectedNames.length} reference file{expectedNames.length === 1 ? '' : 's'}
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto p-1.5">
            {attached.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-elevated">
                <IconPaperclip className="shrink-0 text-sm text-good" aria-hidden="true" />
                <span
                  className="min-w-0 flex-1 truncate font-mono-arena text-xs text-ink"
                  title={`${f.filename}  -  ${Math.ceil(f.size_bytes / 1024)} KB, attached`}
                >
                  {f.filename}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-full border border-line bg-floating px-2 py-0.5 text-[10px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-elevated"
                  onClick={() => setViewingFile(f)}
                  title={`View ${f.filename}`}
                >
                  View
                </button>
                {admin && (
                  <button
                    type="button"
                    className="shrink-0 rounded-full p-1 text-ink-3 transition-colors hover:bg-bad/10 hover:text-bad disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={busy}
                    onClick={() => handleRemove(f.id)}
                    title={`Remove ${f.filename}`}
                    aria-label={`Remove ${f.filename}`}
                  >
                    <IconClose className="text-xs" />
                  </button>
                )}
              </div>
            ))}
            {missing.map((name) => (
              <div key={name} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-elevated">
                <IconPaperclip className="shrink-0 text-sm text-warn" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono-arena text-xs text-warn" title={name}>
                  {name}
                </span>
                {admin ? (
                  <>
                    <button
                      type="button"
                      className="shrink-0 rounded-full bg-warn px-2 py-0.5 text-[10px] font-semibold text-on-cta transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy}
                      onClick={() => fileInputRefs.current[name]?.click()}
                      title={`Attach ${name}`}
                    >
                      {busy ? 'attaching…' : 'Attach'}
                    </button>
                    <input
                      ref={(node) => { fileInputRefs.current[name] = node }}
                      type="file"
                      accept=".md,.json"
                      className="hidden"
                      disabled={busy}
                      onChange={handleUpload}
                    />
                  </>
                ) : (
                  <span className="shrink-0 font-mono-arena text-[10px] text-warn">not attached</span>
                )}
              </div>
            ))}
          </div>
          {error && <p className="border-t border-line px-3 py-1.5 font-mono-arena text-[10px] text-bad">{error}</p>}
        </div>
      )}
    </span>
    {viewingFile && <ReferenceFileModal taskId={task.id_aa} file={viewingFile} onClose={() => setViewingFile(null)} />}
    </>
  )
}

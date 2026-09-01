import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, getUserToken } from '../api.js'
import { useAuth } from '../auth.jsx'
import AuthModal from '../components/AuthModal.jsx'
import Confetti from '../components/Confetti.jsx'
import FileViewer, { FileTabs } from '../components/FileViewer.jsx'
import { IconBrowser } from '../components/icons.jsx'
import ScoreButtons from '../components/ScoreButtons.jsx'
import WebPreview from '../components/WebPreview.jsx'
import { Collapsible, EmptyState, HarnessAvatar, LoadingState, ModelBadge, Notice, SlotBadge, Tag, shuffleSideTokens } from '../components/ui.jsx'
import { isWebProjectTask } from '../lib/webProject.js'

const LETTERS = 'ABCDEFGH'

// Sentinel score key standing in for a web-project run's whole deployed
// frontend — see backend/app/routers/scores.py's WEBSITE_SCORE_KEY, and
// webproject.partition_deliverables for how website_deliverable_ids is
// computed. Must match the backend constant exactly: it's a literal key
// in the scores payload, not a real deliverable id.
const WEBSITE_SCORE_KEY = 'website'

/** Whether this output collapses its own source files into one combined
 *  "Website" score tied to the live Preview, instead of one row per file
 *  (see CompareEntry.website_deliverable_ids). Empty for anything that
 *  isn't a web-project run — every other entry keeps the original
 *  per-deliverable scoring untouched. */
function isWebsiteEntry(entry) {
  return (entry?.website_deliverable_ids?.length ?? 0) > 0
}

/** The exact set of score keys this entry must have a value for before it
 *  counts as fully judged — either [WEBSITE_SCORE_KEY, ...extra file ids]
 *  for a web-project run, or every deliverable id for anything else. Must
 *  mirror the backend's `expected_keys` in routers/scores.py exactly, or
 *  "all scored" here and "every deliverable must receive one score" there
 *  disagree and Submit 400s. */
function requiredScoreKeys(entry) {
  if (isWebsiteEntry(entry)) {
    return [WEBSITE_SCORE_KEY, ...(entry.extra_deliverable_ids ?? []).map(String)]
  }
  return entry.deliverables.map((file) => String(file.id))
}

/** Whether one specific deliverable, within a website entry, still keeps
 *  its own per-file score (the "extra" bucket) rather than being covered
 *  by the combined Website score. Always true for a non-website entry. */
function isScorableFile(entry, file) {
  if (!isWebsiteEntry(entry)) return true
  return (entry.extra_deliverable_ids ?? []).includes(file.id)
}

// The judging page's own chrome above the viewer  -  app header, task heading,
// prompt disclosures, output selector, tab row. FileViewer subtracts this from
// the viewport to size itself (see `.ha-viewer` in theme.css), instead of the
// hard 480px the QA audit measured at every viewport width.
const VIEWER_CHROME_PX = 300

/** The text-safe variant of a slot color. The base --side-* values are tuned
 *  as fills (white on top), which left the "Output A" label at 3.17:1 against
 *  its own card  -  a WCAG 1.4.3 failure at 14px semibold (HA-VW-14). */
const inkToken = (token) => `${token}-ink`

/** Output A/B/C selector  -  one output is reviewed at a time so each file
 *  gets the full width, instead of three cramped columns side by side. */
function OutputTabs({ entries, activeIndex, onSelect, revealed, scores, slotTokens }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Outputs to compare">
      {entries.map((entry, i) => {
        const on = i === activeIndex
        const requiredKeys = requiredScoreKeys(entry)
        const scored = requiredKeys.filter((key) => scores[entry.run_id]?.[key] != null).length
        const token = slotTokens[i % slotTokens.length]
        return (
          <button
            key={entry.run_id}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(i)}
            className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
              on ? 'bg-elevated' : 'border-line bg-surface hover:bg-elevated/60'
            }`}
            style={on ? { borderColor: `var(${token})` } : undefined}
          >
            <SlotBadge index={i} letter={LETTERS[i]} size={26} token={token} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" style={{ color: `var(${inkToken(token)})` }}>
                {revealed ? entry.harness_name : `Output ${LETTERS[i]}`}
              </span>
              <span className="block font-mono-arena text-[11px] text-ink-2">
                {entry.deliverables.length} files · recorded
              </span>
            </span>
            <span className="shrink-0 font-mono-arena text-xs text-ink-2">
              {revealed ? `${entry.already_scored ?? 'N/A'}/10` : `${scored}/${requiredKeys.length}`}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** The pane that holds the scoring controls  -  HA-VW-11.
 *
 *  The score row used to sit 156px BELOW the viewer with nothing on the page
 *  position: sticky, so reaching it cost 408px of page scroll at 1440x900 and
 *  799px at 390x844, and the artifact scrolled out of sight the moment the
 *  judge moved for any other reason. Reading and scoring were competing for
 *  the same screen.
 *
 *  At 1024px and up this is a sticky column beside the artifact. Below that it
 *  docks as a bottom sheet: collapsed it shows the current score and Submit
 *  under the judge's thumb, and the drag handle expands it over the viewer
 *  while leaving the artifact partly visible above. */
function ScorePane({ children, summary, docked = true }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <div className={`ha-score-pane card ${docked ? '' : 'ha-score-pane-static'} ${expanded ? '' : 'ha-score-pane-collapsed'}`}>
        {docked && (
          <button
            type="button"
            className="ha-sheet-handle"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse the scoring panel' : 'Expand the scoring panel'}
          >
            <span>{expanded ? 'Hide scoring' : summary}</span>
          </button>
        )}
        <div className={docked && !expanded ? 'hidden p-4 lg:block' : 'p-4'}>{children}</div>
      </div>
      {/* Keeps the bottom of the page reachable above the docked sheet. */}
      {docked && <div className="ha-sheet-spacer" aria-hidden="true" />}
    </>
  )
}

function ReferenceFiles({ taskId, files }) {
  const [openFileId, setOpenFileId] = useState(null)
  const [contentByFile, setContentByFile] = useState({})
  const [loadingFileId, setLoadingFileId] = useState(null)
  const [error, setError] = useState('')

  async function toggleFile(file) {
    if (openFileId === file.id) {
      setOpenFileId(null)
      return
    }
    setOpenFileId(file.id)
    setError('')
    if (contentByFile[file.id] != null) return
    setLoadingFileId(file.id)
    try {
      const content = await api.getReferenceFileContent(taskId, file.id)
      setContentByFile((current) => ({ ...current, [file.id]: content }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingFileId(null)
    }
  }

  return (
    <div className="space-y-2 text-sm text-ink-2">
      {files.map((file) => (
        <div key={file.id} className="rounded-lg border border-line bg-floating">
          <button
            type="button"
            onClick={() => toggleFile(file)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-elevated"
            aria-expanded={openFileId === file.id}
          >
            <span className="min-w-0 truncate font-mono-arena text-xs text-ink">{file.filename}</span>
            <span className="shrink-0 text-xs text-link">{openFileId === file.id ? 'Hide' : 'View'}</span>
          </button>
          {openFileId === file.id && (
            <div className="border-t border-line px-3 py-2">
              {loadingFileId === file.id ? (
                <p className="text-xs text-ink-3">Loading reference file…</p>
              ) : contentByFile[file.id] != null ? (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono-arena text-xs leading-relaxed text-ink">
                  {contentByFile[file.id]}
                </pre>
              ) : null}
            </div>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  )
}

/** Score only the deliverable currently open in the viewer.  Scores are
 *  keyed by both run and deliverable, so a selection never carries into a
 *  different output or file. */
function ScoreBar({ entries, scores, draftScores, activeEntry, activeFile, onDraftScore, onSubmitScore, submitting, allScored, insufficientToJudge, onSubmit, slotTokens }) {
  const slotIndex = activeEntry ? entries.indexOf(activeEntry) : 0
  const token = slotTokens[slotIndex % slotTokens.length]
  const accent = `var(${token})`
  const accentInk = `var(${inkToken(token)})`
  const websiteMode = activeEntry ? isWebsiteEntry(activeEntry) : false
  // The file open in the code viewer only gets its own score card when it's
  // actually one of the required scoring keys — for a website entry that's
  // just the "extra" files (a report/dataset outside the deployed app);
  // every source file that makes up the site itself is scored once, below,
  // as the combined website card instead.
  const showFileCard = activeEntry && activeFile && (!websiteMode || isScorableFile(activeEntry, activeFile))
  const selectedScore = showFileCard ? scores[activeEntry.run_id]?.[activeFile.id] : null
  const websiteScore = activeEntry && websiteMode ? scores[activeEntry.run_id]?.[WEBSITE_SCORE_KEY] : null
  const selectedDraft = showFileCard ? (draftScores[activeEntry.run_id]?.[activeFile.id] ?? selectedScore) : null
  const websiteDraft = activeEntry && websiteMode ? (draftScores[activeEntry.run_id]?.[WEBSITE_SCORE_KEY] ?? websiteScore) : null
  return (
    <div className="flex flex-col gap-4">
      {activeEntry && websiteMode && (
        <div
          className="rounded-xl border-2 p-4"
          style={{ borderColor: accent, background: `color-mix(in srgb, ${accent} 10%, var(--surface))` }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SlotBadge index={slotIndex} letter={LETTERS[slotIndex]} size={20} token={token} />
                <p className="eyebrow" style={{ color: accentInk }}>Score the website</p>
              </div>
              <p className="mt-2 text-xs text-ink-2">
                One score for the whole running site shown in the Preview tab above — not per source file.
              </p>
            </div>
            {websiteScore != null && (
              <span className="flex items-center gap-1.5">
                <span className="rounded-full bg-good/15 px-2 py-1 font-mono-arena text-[10px] font-semibold uppercase tracking-wider text-good">Graded</span>
                <span className="rounded-full px-2.5 py-1 font-mono-arena text-xs font-semibold text-white" style={{ background: accent }}>
                  {websiteScore}/10
                </span>
              </span>
            )}
          </div>
          <div className="mt-4 border-t border-line/70 pt-4">
            <ScoreButtons
              value={websiteDraft}
              onChange={(v) => onDraftScore(activeEntry.run_id, WEBSITE_SCORE_KEY, v)}
              disabled={submitting}
              slotIndex={slotIndex}
            />
            <button
              type="button"
              className="btn-secondary mt-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              disabled={submitting || websiteDraft == null || websiteDraft === websiteScore}
              onClick={() => onSubmitScore(activeEntry.run_id, WEBSITE_SCORE_KEY, websiteDraft)}
            >
              {websiteScore != null && websiteDraft === websiteScore ? 'Score submitted' : 'Submit score'}
            </button>
          </div>
        </div>
      )}
      {showFileCard && (
        <div
          className="rounded-xl border-2 p-4"
          style={{ borderColor: accent, background: `color-mix(in srgb, ${accent} 10%, var(--surface))` }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SlotBadge index={slotIndex} letter={LETTERS[slotIndex]} size={20} token={token} />
                <p className="eyebrow" style={{ color: accentInk }}>Score this deliverable</p>
              </div>
              <p className="mt-2 break-all font-mono-arena text-xs text-ink">{activeFile.filename}</p>
              <p className="mt-1 text-xs text-ink-2">Equal weight in this output&apos;s final score.</p>
            </div>
            {selectedScore != null && (
              <span className="flex items-center gap-1.5">
                <span className="rounded-full bg-good/15 px-2 py-1 font-mono-arena text-[10px] font-semibold uppercase tracking-wider text-good">Graded</span>
                <span className="rounded-full px-2.5 py-1 font-mono-arena text-xs font-semibold text-white" style={{ background: accent }}>
                  {selectedScore}/10
                </span>
              </span>
            )}
          </div>
          <div className="mt-4 border-t border-line/70 pt-4">
            <ScoreButtons value={selectedDraft} onChange={(v) => onDraftScore(activeEntry.run_id, activeFile.id, v)} disabled={submitting} slotIndex={slotIndex} />
            <button
              type="button"
              className="btn-secondary mt-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              disabled={submitting || selectedDraft == null || selectedDraft === selectedScore}
              onClick={() => onSubmitScore(activeEntry.run_id, activeFile.id, selectedDraft)}
            >
              {selectedScore != null && selectedDraft === selectedScore ? 'Score submitted' : 'Submit score'}
            </button>
          </div>
        </div>
      )}
      {/* Progress across every deliverable of the open output, so the judge
          can see what is still unscored without leaving the artifact. */}
      {activeEntry && (
        <DeliverableScoreList
          entry={activeEntry}
          scores={scores[activeEntry.run_id]}
          activeFileId={activeFile?.id}
          token={token}
        />
      )}
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <p className="min-w-0 text-[11px] leading-relaxed text-ink-2">
          Scores are stored in this arena and feed the public Elo leaderboard. Once you submit, this task is locked
          for you. You won&apos;t be able to re-score it after identities are revealed.
        </p>
        {insufficientToJudge ? (
          <span className="text-xs text-bad">insufficient results to judge  -  needs at least two outputs</span>
        ) : (
          !allScored && <span className="text-xs text-ink-2">score every deliverable</span>
        )}
        <button
          type="button"
          className={`btn-cta whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 ${!allScored ? 'blur-[1px]' : ''}`}
          disabled={!allScored || submitting}
          onClick={onSubmit}
        >
          Submit scores &amp; reveal
        </button>
      </div>
    </div>
  )
}

/** Per-deliverable scores, listed beside the artifact they belong to.
 *
 *  HA-VW-19: once the task locked, the banner REPLACED the whole score panel,
 *  so the judge's own per-deliverable scores vanished from the scoring area
 *  entirely. `readOnly` keeps exactly this list visible after locking instead. */
function DeliverableScoreList({ entry, scores, activeFileId, token, readOnly = false }) {
  // For a website entry, one combined row stands in for every file inside
  // the deployed frontend (see isWebsiteEntry); only the "extra" files
  // (outside it, but still an expected deliverable) keep their own row.
  // Files that are neither website nor extra are shown elsewhere (the code
  // tree) but were never required to be scored, so they're left out here.
  const rows = isWebsiteEntry(entry)
    ? [
        { key: WEBSITE_SCORE_KEY, label: 'Website (live preview)', active: false },
        ...entry.deliverables
          .filter((file) => (entry.extra_deliverable_ids ?? []).includes(file.id))
          .map((file) => ({ key: String(file.id), label: file.filename, active: !readOnly && file.id === activeFileId })),
      ]
    : entry.deliverables.map((file) => ({
        key: String(file.id),
        label: file.filename,
        active: !readOnly && file.id === activeFileId,
      }))
  return (
    <ul className="space-y-1">
      {rows.map((row) => {
        const value = scores?.[row.key]
        return (
          <li
            key={row.key}
            className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 ${
              row.active ? 'border-line-strong bg-elevated' : 'border-transparent'
            }`}
          >
            <span className="min-w-0 truncate font-mono-arena text-[11px] text-ink-2">{row.label}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {value != null && <span className="rounded bg-good/15 px-1.5 py-0.5 font-mono-arena text-[9px] font-semibold uppercase tracking-wider text-good">Graded</span>}
              <span
                className="rounded px-1.5 py-0.5 font-mono-arena text-[11px] font-semibold"
                style={
                  value != null
                    ? { background: `var(${token})`, color: '#fff' }
                    : { background: 'var(--floating)', color: 'var(--ink-2)' }
                }
              >
                {value != null ? `${value}/10` : 'not scored'}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function RevealCard({ entry, index, score, token }) {
  const hasJudge = entry.judge_score != null
  const delta = hasJudge && score != null ? Number((score - entry.judge_score).toFixed(1)) : null
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <SlotBadge index={index} letter={LETTERS[index]} size={20} token={token} />
        <span className="text-ink-3" aria-hidden="true">
          →
        </span>
        <HarnessAvatar harnessKey={entry.harness_key} name={entry.harness_name} size={24} />
        <p className="font-display font-semibold">{entry.harness_name}</p>
      </div>

      <div className="mt-4 flex items-end justify-between border-t border-line pt-3">
        <div>
          <p className="eyebrow">You</p>
          <p className="font-display text-2xl font-semibold">
            {score ?? 'N/A'}
            <span className="text-sm text-ink-3">/10</span>
          </p>
        </div>
        <div className="text-right">
          <p className="eyebrow">Artificial Analysis AI judge</p>
          <p className={`font-display text-2xl font-semibold ${hasJudge ? '' : 'text-ink-3'}`}>
            {hasJudge ? entry.judge_score : 'Coming soon'}
            {hasJudge && <span className="text-sm text-ink-3">/10</span>}
          </p>
        </div>
      </div>

      {delta != null && (
        <p className="mt-3 font-mono-arena text-[11px] text-ink-3">
          {delta === 0 ? 'exact agreement' : `you scored ${delta > 0 ? '+' : ''}${delta} vs the judge`}
        </p>
      )}
      {!hasJudge && entry.judge_note && <p className="mt-3 text-[11px] italic text-ink-3">{entry.judge_note}</p>}

      {entry.judge_breakdown?.length > 0 && (
        <div className="mt-4 border-t border-line">
          <Collapsible label={`Artificial Analysis AI judge rationale (${entry.judge_breakdown.length} criteria)`}>
            <ul className="space-y-4">
              {entry.judge_breakdown.map((c) => (
                <li key={c.name}>
                  <p className="flex items-center justify-between gap-2 font-mono-arena text-xs">
                    <span className="text-ink">{c.name.replace(/_/g, ' ')}</span>
                    <span className="shrink-0 text-ink-3">
                      {c.earned}/{c.max}
                      {c.weight > 1 ? ` ×${c.weight}` : ''}
                    </span>
                  </p>
                  <p className="mt-1.5 leading-relaxed">{c.narrative}</p>
                </li>
              ))}
            </ul>
          </Collapsible>
        </div>
      )}
    </div>
  )
}

export default function Eval() {
  const { user, loading: authLoading } = useAuth()
  const { taskId } = useParams()
  const [searchParams] = useSearchParams()
  const providerConfigId = searchParams.get('model') ? Number(searchParams.get('model')) : null
  // When there's no `runs` param at all (the normal case  -  just opening a
  // task directly, not following a Battle Log link scoped to one specific
  // comparison), `''.split(',')` is `['']`, and `Number('')` is `0`  -  a
  // real, valid-looking integer, not NaN. Without filtering it out first,
  // EVERY plain task visit sent run_ids=[0] to the backend, which then
  // 404s with "one or more selected completed runs no longer exist" since
  // run id 0 never exists. `filter(Boolean)` drops that empty segment
  // before it ever reaches Number(), so no `runs` param means what it
  // should: an empty list, i.e. "use the normal latest-run-per-harness
  // set," not "a specific run id 0."
  const runIds = useMemo(
    () =>
      (searchParams.get('runs') || '')
        .split(',')
        .filter(Boolean)
        .map(Number)
        .filter(Number.isInteger),
    [searchParams]
  )
  const navigate = useNavigate()
  const location = useLocation()
  // Wherever the user actually clicked "Judge"/"Grade now" from  -  Battle
  // Log's link and Evaluate's judge() both pass this via router state (see
  // BattleLog.jsx and Evaluate.jsx). Falls back to Evaluate only when this
  // page was opened some other way (a bookmark, a direct URL), since that's
  // this app's main task-browsing page.
  const backTo = location.state?.from || '/evaluate'
  const backLabel = backTo === '/battles' ? 'Battle Log' : 'all tasks'
  const [task, setTask] = useState(null)
  const [compareData, setCompareData] = useState(null)
  // Fires only right after THIS viewer's own submit() causes a reveal (see
  // below) — never on a page load that lands on an already-revealed task,
  // which would make the confetti feel random rather than earned.
  const [celebrate, setCelebrate] = useState(false)
  const [allTasks, setAllTasks] = useState([])
  const [scores, setScores] = useState({})
  const [draftScores, setDraftScores] = useState({})
  const [activeOutput, setActiveOutput] = useState(0)
  const [activeFileId, setActiveFileId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [taskInProgress, setTaskInProgress] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authForSubmit, setAuthForSubmit] = useState(false)
  const [referenceFiles, setReferenceFiles] = useState([])
  const submissionInFlight = useRef(false)

  // A judging page is a member-only action. Open the normal account dialog
  // as soon as an unsigned visitor enters it rather than after they have
  // spent time reviewing outputs and clicked Submit.
  useEffect(() => {
    if (!authLoading && !user) {
      setAuthForSubmit(false)
      setShowAuth(true)
    }
  }, [authLoading, user, taskId])

  useEffect(() => {
    setNotFound(false)
    setError('')
    setLoadError('')
    setTaskInProgress(false)
    setActiveOutput(0)
    setActiveFileId(null)
    api.getTask(taskId).then(setTask).catch(() => setNotFound(true))
    api.listReferenceFiles(taskId).then(setReferenceFiles).catch(() => setReferenceFiles([]))
    api.listTasks().then(setAllTasks).catch(() => {})
    let cancelled = false
    let retryTimer

    const loadComparison = async () => {
      try {
        const runs = await api.listRunsForTask(taskId, providerConfigId)
        if (cancelled) return
        const relevantRuns = runIds.length ? runs.filter((run) => runIds.includes(run.id)) : runs
        if (relevantRuns.some((run) => run.status === 'pending' || run.status === 'running')) {
          setTaskInProgress(true)
          setCompareData(null)
          retryTimer = window.setTimeout(loadComparison, 3000)
          return
        }

        setTaskInProgress(false)
        const data = await api.compare(taskId, providerConfigId, runIds)
        if (cancelled) return
        setCompareData(data)
        const initial = {}
        data.entries.forEach((e) => {
          if (e.already_scored != null) initial[e.run_id] = e.deliverable_scores ?? {}
        })
        setScores(initial)
        setDraftScores(initial)
      } catch (e) {
        if (cancelled) return
        if (/still in progress/i.test(e.message)) {
          setTaskInProgress(true)
          retryTimer = window.setTimeout(loadComparison, 3000)
          return
        }
        setLoadError(e.message)
      }
    }
    loadComparison()
    return () => {
      cancelled = true
      window.clearTimeout(retryTimer)
    }
  }, [taskId, providerConfigId, runIds])

  // A fresh color-to-slot mapping every time a comparison actually loads  -
  // "Output A" isn't always the same color any more than it's always the
  // same harness (see routers/scores.py's per-request shuffle). Recomputed
  // only when compareData itself changes, not on every render.
  const slotTokens = useMemo(() => shuffleSideTokens(), [compareData])

  const entries = compareData?.entries ?? []
  const current = entries[activeOutput]
  const files = current?.deliverables ?? []

  // Every output/file has its own score. When moving to another output we
  // deliberately start at that output's first file rather than preserving a
  // filename selection from the previous output.
  useEffect(() => {
    if (!files.length) {
      setActiveFileId(null)
      return
    }
    if (files.some((f) => f.id === activeFileId)) return
    setActiveFileId(files[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0]
  // At least two outputs are required to judge anything  -  one output has
  // nothing to compare against. The backend enforces this too (POST
  // /api/scores rejects fewer than two done runs), so this isn't purely
  // cosmetic; it's here so the button reads as unavailable up front
  // instead of failing with a 400 after the fact.
  const insufficientToJudge = entries.length < 2
  const allScored =
    !insufficientToJudge &&
    entries.every((e) => requiredScoreKeys(e).every((key) => scores[e.run_id]?.[key] != null))

  // Shown on the collapsed mobile scoring sheet, so a judge can see how much
  // is left without expanding it. Counts required score KEYS, not raw file
  // count — a website entry's whole frontend is one key (see
  // requiredScoreKeys), same thing "score every deliverable" above checks.
  const totalDeliverables = entries.reduce((n, e) => n + requiredScoreKeys(e).length, 0)
  const scoredCount = entries.reduce(
    (n, e) => n + requiredScoreKeys(e).filter((key) => scores[e.run_id]?.[key] != null).length,
    0
  )

  const nextTaskId = useMemo(() => {
    const i = allTasks.findIndex((t) => t.id_aa === taskId)
    if (i === -1) return null
    return allTasks[(i + 1) % allTasks.length]?.id_aa ?? null
  }, [allTasks, taskId])

  const winner = useMemo(() => {
    if (!compareData?.revealed) return null
    let best = null
    entries.forEach((e) => {
      const v = e.already_scored
      if (v == null) return
      if (!best || v > best.value) best = { value: v, entry: e }
    })
    const topCount = entries.filter((e) => e.already_scored === best?.value).length
    return best && topCount === 1 ? best : null
  }, [compareData, entries, scores])

  const judgeWinner = useMemo(() => {
    if (!compareData?.revealed) return null
    let best = null
    entries.forEach((e) => {
      if (e.judge_score == null) return
      if (!best || e.judge_score > best.value) best = { value: e.judge_score, entry: e }
    })
    const topCount = entries.filter((e) => e.judge_score === best?.value).length
    return best && topCount === 1 ? best : null
  }, [compareData, entries])

  const anyJudgeScore = entries.some((e) => e.judge_score != null)

  function submitDeliverableScore(runId, fileId, value) {
    setScores((prev) => ({ ...prev, [runId]: { ...prev[runId], [fileId]: value } }))
    if (current?.run_id !== runId) return
    const keys = requiredScoreKeys(current)
    const nextKey = keys[keys.indexOf(String(fileId)) + 1]
    if (nextKey && nextKey !== WEBSITE_SCORE_KEY) setActiveFileId(Number(nextKey))
  }

  async function submit() {
    // Read the token directly rather than the `user` state: this can be
    // called from the AuthModal's onSuccess right after a fresh login,
    // before this component's own re-render (and thus `user` closure) has
    // caught up. Check the token that api.submitScores actually sends
    // avoids a false "not signed in" loop in that moment.
    if (!getUserToken()) {
      setAuthForSubmit(true)
      setShowAuth(true)
      return
    }
    if (submitting || submissionInFlight.current) return
    submissionInFlight.current = true
    setSubmitting(true)
    setError('')
    try {
      const payload = {}
      entries.forEach((e) => {
        payload[String(e.run_id)] = scores[e.run_id]
      })
      await api.submitScores(taskId, payload, providerConfigId, runIds)
      const fresh = await api.compare(taskId, providerConfigId, runIds)
      setCompareData(fresh)
      if (fresh?.revealed) setCelebrate(true)
    } catch (err) {
      setError(err.message)
    } finally {
      submissionInFlight.current = false
      setSubmitting(false)
    }
  }

  if (notFound) {
    return (
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-semibold">Task not found</h1>
        <p className="text-ink-2">There is no recorded benchmark task with this id.</p>
        <Link to={backTo} className="btn-secondary inline-block text-sm">
          Back to {backLabel}
        </Link>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-semibold">Couldn&apos;t load this task</h1>
        <p className="text-bad">{loadError}</p>
        <Link to={backTo} className="btn-secondary inline-block text-sm">
          Back to {backLabel}
        </Link>
      </div>
    )
  }

  if (taskInProgress && task) {
    return (
      <div className="space-y-5">
        <Link to={backTo} className="text-sm text-link">← Back to {backLabel}</Link>
        <div className="card max-w-2xl p-6 sm:p-8">
          <p className="eyebrow">Evaluation unavailable</p>
          <h1 className="font-display mt-1 text-2xl font-semibold">This task is still in progress</h1>
          <p className="mt-3 leading-relaxed text-ink-2">
            Wait for every queued or running output to reach a final status before judging. This page checks again automatically.
          </p>
          <Link to="/battles" className="btn-secondary mt-5 inline-block text-sm">View run progress</Link>
        </div>
      </div>
    )
  }

  if (!task || !compareData) return <LoadingState label="Loading comparison…" />

  return (
    <div className="space-y-5">
      <Confetti active={celebrate} onDone={() => setCelebrate(false)} />
      <div>
        <Link to={backTo} className="text-sm text-link">
          ← Back to {backLabel}
        </Link>
        <p className="eyebrow mt-3">
          {task.group} · {compareData.revealed ? 'Identities revealed' : 'Ranked evaluation'}
        </p>
        <h1 className="font-display mt-1 flex items-center gap-2 text-2xl font-semibold leading-tight sm:text-3xl">
          {task.title}
          {isWebProjectTask(task) && (
            <span className="inline-flex shrink-0 text-link" title="Web app task" aria-label="Web app task">
              <IconBrowser className="text-xl" />
            </span>
          )}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Tag>{task.category}</Tag>
          <span className="font-mono-arena text-[11px] text-ink-3">{task.id_aa}</span>
          {entries[0]?.model && <ModelBadge model={entries[0].model} />}
        </div>
      </div>

      {!compareData.revealed && (
        <Notice icon="⚖">
          Outputs are anonymized. Identities and the AI judge&apos;s scores reveal after you score all{' '}
          {entries.length} outputs.
        </Notice>
      )}

      <div className="card px-5 py-1">
        <Collapsible label="Full prompt">
          <p className="whitespace-pre-wrap leading-relaxed">{task.prompt || 'Not provided'}</p>
        </Collapsible>
        <Collapsible label="System prompt">
          <p className="whitespace-pre-wrap leading-relaxed">{task.system_prompt || 'Not provided'}</p>
        </Collapsible>
        <Collapsible label="Rubric">
          <p className="whitespace-pre-wrap font-mono-arena text-xs leading-relaxed">{task.rubric || 'Not provided'}</p>
        </Collapsible>
        <Collapsible label="Expected deliverables">
          {task.deliverable_files?.length ? (
            <ul className="space-y-1 font-mono-arena text-xs">
              {task.deliverable_files.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
          ) : (
            <p>Not provided</p>
          )}
        </Collapsible>
        {referenceFiles.length > 0 && (
          <Collapsible label={`Reference files (${referenceFiles.length})`}>
            <ReferenceFiles taskId={task.id_aa} files={referenceFiles} />
          </Collapsible>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState>
          No completed outputs for this task yet. Start a battle from{' '}
          <Link to="/evaluate" className="text-link">
            Evaluate
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          <OutputTabs
            entries={entries}
            activeIndex={activeOutput}
            onSelect={(index) => {
              setActiveOutput(index)
              setActiveFileId(null)
            }}
            revealed={compareData.revealed}
            scores={scores}
            slotTokens={slotTokens}
          />

          {/* HA-VW-11: the artifact and the scoring controls sit side by side
              now, with the scoring pane sticky, so reading and scoring never
              compete for the same screen. Nothing about the scoring model
              changes  -  same outputs, same 0-10 scale, same warning, same
              primary button; only its position on the page. */}
          {/* The tab row sits ABOVE the split rather than inside its left
              column, so the viewer card and the scoring card share a top
              edge. Nesting it in the left column pushed that column's card
              down by the height of the tab row, leaving the two panels
              visibly misaligned — and correcting that with a matching top
              margin on the pane would have hard-coded the tab row's height. */}
          {/* Self-hides for anything that isn't a web-development run's
              deliverables (see WebPreview.jsx) — safe to mount for every
              entry's current output unconditionally. */}
          <WebPreview runId={current.run_id} files={files} />

          <div className="space-y-2">
            {/* WebPreview above already has its own Preview | Code toggle
                over this exact file list (see WebPreview.jsx's CodeView) —
                a website entry doesn't need this second, duplicate file
                tree + viewer underneath it too. Non-web entries have no
                WebPreview panel at all (it self-hides), so this is their
                only viewer and stays. */}
            {!isWebsiteEntry(current) && <FileTabs files={files} activeId={activeFile?.id} onSelect={setActiveFileId} />}

            <div className={`ha-eval-split ${isWebsiteEntry(current) ? 'ha-eval-split--single' : ''}`}>
            {!isWebsiteEntry(current) && (
              <div className="min-w-0 space-y-2">
                {/* One panel per artifact, each labelled by its own tab, so the
                    tab/panel relationship is programmatic rather than a CSS
                    class alone (HA-VW-12). Only the open one is mounted, so
                    switching never leaves a second renderer alive. */}
                {files.map((f) => (
                  <div
                    key={f.id}
                    id={`ha-panel-${f.id}`}
                    role="tabpanel"
                    aria-labelledby={`ha-tab-${f.id}`}
                    hidden={f.id !== activeFile?.id}
                  >
                    {f.id === activeFile?.id && <FileViewer file={f} chrome={VIEWER_CHROME_PX} />}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="text-sm text-bad">{error}</p>}

            <ScorePane
              docked={!compareData.revealed}
              summary={
                compareData.revealed
                  ? 'Scores are final'
                  : `Scoring · ${scoredCount} of ${totalDeliverables} deliverables`
              }
            >
              {/* Once revealed, this user's scoring is closed. Another score
                  would no longer be blind. Other signed-in users can still
                  submit their own independent blind verdict. */}
              {submitting ? (
                <LoadingState label="Submitting scores and revealing results…" />
              ) : !compareData.revealed ? (
                <ScoreBar
                  entries={entries}
                  scores={scores}
                  draftScores={draftScores}
                  activeEntry={current}
                  activeFile={activeFile}
                  onDraftScore={(runId, fileId, v) =>
                    setDraftScores((prev) => ({ ...prev, [runId]: { ...prev[runId], [fileId]: v } }))
                  }
                  onSubmitScore={submitDeliverableScore}
                  submitting={submitting}
                  revealed={false}
                  allScored={allScored}
                  insufficientToJudge={insufficientToJudge}
                  onSubmit={submit}
                  slotTokens={slotTokens}
                />
              ) : (
                /* HA-VW-19: the lock used to be a plain div that REPLACED the
                   entire score panel, so the judge's own per-deliverable
                   scores disappeared from the scoring area, and it carried no
                   role and no aria-live so the transition was never
                   announced. Both are fixed here: the scores stay, read-only,
                   and the banner is a live region. */
                <div className="space-y-3">
                  <p
                    className="rounded-lg border border-line-strong bg-floating px-3 py-2 text-xs leading-relaxed text-ink"
                    role="status"
                    aria-live="polite"
                  >
                    <span aria-hidden="true">🔒 </span>
                    You have judged this task. Your scores are final and can&apos;t be changed.
                  </p>
                  {current && (
                    <>
                      <p className="eyebrow">Your scores for this output</p>
                      <DeliverableScoreList
                        entry={current}
                        scores={scores[current.run_id]}
                        token={slotTokens[entries.indexOf(current) % slotTokens.length]}
                        readOnly
                      />
                    </>
                  )}
                </div>
              )}
            </ScorePane>
            </div>
          </div>

          {compareData.revealed && (
            <div className="space-y-4">
              <div>
                <p className="eyebrow">Identities revealed</p>
                <h2 className="font-display mt-1 text-2xl font-semibold">Your scores vs Artificial Analysis AI judge</h2>
              </div>

              {!anyJudgeScore ? (
                <Notice icon="ⓘ">Artificial Analysis AI judge coming soon. Your rating stands alone.</Notice>
              ) : winner && judgeWinner && winner.entry.run_id === judgeWinner.entry.run_id ? (
                <Notice icon="✓">
                  You and the judge agree: <strong>{winner.entry.harness_name}</strong> comes out ahead.
                </Notice>
              ) : winner && judgeWinner ? (
                <Notice icon="ⓘ">
                  You and the judge disagree. You picked <strong>{winner.entry.harness_name}</strong>, the judge
                  favored <strong>{judgeWinner.entry.harness_name}</strong>.
                </Notice>
              ) : (
                <Notice icon="ⓘ">The judge didn&apos;t reach a clear verdict across every output here.</Notice>
              )}

              <div className="grid gap-4 lg:grid-cols-3">
                {entries.map((entry, i) => (
                  <RevealCard
                    key={entry.run_id}
                    entry={entry}
                    index={i}
                    score={entry.already_scored}
                    token={slotTokens[i % slotTokens.length]}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between border-t border-line pt-4">
        <Link to={backTo} className="btn-secondary text-sm">
          {backTo === '/battles' ? 'Battle Log' : 'All tasks'}
        </Link>
        {nextTaskId && nextTaskId !== taskId && (
          <button type="button" className="btn-secondary text-sm" onClick={() => navigate(`/eval/${nextTaskId}`)}>
            Next task →
          </button>
        )}
      </div>

      {showAuth && (
        <AuthModal
          reason="Sign in to judge this task. Every judgement is attributed to an account."
          onClose={() => {
            setShowAuth(false)
            // This modal is either the forced "you need an account to be
            // here" gate (authForSubmit false  -  dismissing it without
            // signing in leaves this page unusable, so send them somewhere
            // that still is) or the one opened by clicking Submit while
            // signed out (authForSubmit true  -  they were already using the
            // page fine, so just let them keep looking around it).
            if (!authForSubmit) navigate('/leaderboard')
          }}
          onSuccess={() => {
            setShowAuth(false)
            if (authForSubmit) {
              setAuthForSubmit(false)
              submit()
            }
          }}
        />
      )}
    </div>
  )
}

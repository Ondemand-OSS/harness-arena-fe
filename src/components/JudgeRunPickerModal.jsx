import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.js'
import { HarnessAvatar, LoadingState, ModelBadge } from './ui.jsx'

/** Picks which comparable "battle" to open for a task, for the case where
 *  more than one exists. Regenerate no longer dedupes runs (see
 *  backend/app/runner.py's run_task), so a task can easily accumulate
 *  several distinct model-profile groups over time  -  different profiles
 *  run at different points, not just one "the" current comparison.
 *
 *  `groups` (from Evaluate.jsx's comparisonGroups) includes every group
 *  regardless of size  -  a >=2-harness one is judgeable (blind score); a
 *  1-harness one has nothing to compare against, so it's listed for
 *  visibility (so it doesn't just silently disappear) but disabled,
 *  labeled "Insufficient results to judge"  -  same wording/reddish tone
 *  Battle Log uses for the same situation (see BattleLog.jsx's
 *  resolveRowStatus). The backend's POST /api/scores rejects a submission
 *  covering fewer than two harnesses too, so this isn't just cosmetic.
 *
 *  Rows are ranked by existing community vote count, most first  -  fetched
 *  per group here rather than passed in, since GET /compare only ever
 *  resolves stats for the one group it's scoped to; there's no bulk
 *  "vote counts for every group" endpoint. `groups` is small in practice
 *  (a handful of distinct profiles per task at most), so one request per
 *  group is cheap. */
export default function JudgeRunPickerModal({ taskId, groups, harnessesByKey, onSelect, onClose }) {
  const [ranked, setRanked] = useState(null) // null while loading

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    Promise.all(
      groups.map(async (g) => {
        try {
          const cmp = await api.compare(taskId, g.profileId, null, true)
          const votes = cmp.entries.reduce((sum, e) => sum + (e.community_vote_count || 0), 0)
          return { ...g, votes }
        } catch {
          return { ...g, votes: 0 }
        }
      })
    ).then((rows) => {
      if (cancelled) return
      setRanked(rows.sort((a, b) => b.votes - a.votes || b.harnessCount - a.harnessCount))
    })
    return () => {
      cancelled = true
    }
  }, [taskId, groups])

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4">
      {/* `fixed`, not `absolute` — see ModelPickerModal's identical backdrop
          for why: `absolute` here only covers one viewport-height, not the
          full scrollable dialog. */}
      <button type="button" className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div role="dialog" aria-modal="true" aria-labelledby="judge-picker-title" className="card w-full max-w-lg p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Multiple comparisons</p>
              <h2 id="judge-picker-title" className="font-display mt-1 text-2xl font-semibold">
                Pick which battle to judge
              </h2>
              <p className="mt-2 text-sm text-ink-2">
                This task has more than one completed comparison  -  different models, or repeat runs of the same one.
                Most-voted first.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 -mt-2 grid h-9 w-9 shrink-0 place-items-center rounded text-xl leading-none text-ink-2 hover:bg-elevated hover:text-ink"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="mt-5 space-y-2">
            {ranked === null && <LoadingState compact label="Loading available runs…" />}
            {ranked?.map((g) => {
              const judgeable = g.harnessCount >= 2
              return (
                <button
                  key={String(g.profileId)}
                  type="button"
                  disabled={!judgeable}
                  onClick={() => judgeable && onSelect(g.profileId)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                    judgeable ? 'border-line bg-floating hover:bg-elevated' : 'cursor-not-allowed border-line bg-floating opacity-70'
                  }`}
                >
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      {g.model ? <ModelBadge model={g.model} /> : <span className="text-sm text-ink-2">Unspecified model</span>}
                      <span className="text-xs text-ink-3">
                        {g.harnessCount} harness{g.harnessCount === 1 ? '' : 'es'} compared
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {g.harnessKeys.map((key) => (
                        <span key={key} className="inline-flex items-center gap-1 rounded-full bg-elevated px-1.5 py-0.5 text-[10px] text-ink-2">
                          <HarnessAvatar harnessKey={key} name={harnessesByKey[key]?.name ?? key} size={14} />
                          {harnessesByKey[key]?.name ?? key}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono-arena text-xs text-ink-3">
                      {g.votes > 0 ? `${g.votes} vote${g.votes === 1 ? '' : 's'}` : 'no votes yet'}
                    </span>
                    <span className={`text-xs font-semibold ${judgeable ? 'text-cta' : 'text-bad'}`}>
                      {judgeable ? 'Judge' : 'Insufficient results to judge'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

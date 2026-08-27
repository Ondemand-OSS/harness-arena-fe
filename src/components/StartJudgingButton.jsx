import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import AuthModal from './AuthModal.jsx'
import { IconEvaluate, IconSetup } from './icons.jsx'

/** Two ways in: judge work that has already been run, or put a new dataset
 *  through the harnesses. Presented as a choice because they're genuinely
 *  different intents  -  one is reviewing, the other is producing. */
function ChoiceOverlay({ onClose }) {
  const navigate = useNavigate()
  const [state, setState] = useState(null)

  useEffect(() => {
    api.nextUnjudged().then(setState).catch(() => setState({ reason: 'error' }))
  }, [])

  // Escape closes, matching normal dialog behavior.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function go(path) {
    onClose()
    navigate(path)
  }

  const ready = state?.ready ?? 0
  const judged = state?.judged ?? 0
  const nextId = state?.task_id

  // Portaled to document.body  -  this used to render inline inside
  // StartJudgingButton, which mounts inside the sidebar's `position: fixed`
  // <aside> (App.jsx). A fixed ancestor always opens its own stacking
  // context, so no z-index here could lift the overlay above sibling
  // content (e.g. the leaderboard's podium cards) that paints later in DOM
  // order at the same root stacking tier  -  it showed through underneath.
  // Every other modal in the app (AuthModal, ModelPickerModal, Setup,
  // Evaluate) already portals out for the same reason; z-[100] matches
  // their tier too.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* `fixed`, not `absolute` — matches every other modal's backdrop in
          this app (see ModelPickerModal) for the same reason, even though
          this wrapper isn't itself scrollable today: `absolute` here is
          only ever correctly sized by coincidence (one viewport-height),
          not because it's actually pinned to the viewport. */}
      <button
        type="button"
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Start judging"
        className="card relative z-10 w-full max-w-lg p-6"
      >
        <p className="eyebrow">Start judging</p>
        <h2 className="font-display mt-1 text-2xl font-semibold">What would you like to do?</h2>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            disabled={!nextId && ready === 0}
            onClick={() => go(nextId ? `/eval/${nextId}` : '/evaluate')}
            className="flex w-full items-start gap-3 rounded-lg border border-line bg-floating p-4 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconEvaluate className="mt-0.5 shrink-0 text-lg text-ink-2" />
            <span className="min-w-0">
              <span className="block font-semibold">Judge already-completed tasks</span>
              <span className="mt-0.5 block text-sm text-ink-2">
                {state == null
                  ? 'Checking what’s available…'
                  : ready === 0
                    ? 'Nothing has been run yet. Benchmark a task first.'
                    : nextId
                      ? `${ready} task${ready === 1 ? '' : 's'} with results · you have already judged ${judged}. Jump to the next one.`
                      : `You have judged all ${ready} task${ready === 1 ? '' : 's'}. Open the list to review.`}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => go('/benchmark')}
            className="flex w-full items-start gap-3 rounded-lg border border-line bg-floating p-4 text-left transition-colors hover:bg-elevated"
          >
            <IconSetup className="mt-0.5 shrink-0 text-lg text-ink-2" />
            <span className="min-w-0">
              <span className="block font-semibold">Benchmark a new task</span>
              <span className="mt-0.5 block text-sm text-ink-2">
                Upload a benchmark dataset and submit it to the harnesses for evaluation.
              </span>
            </span>
          </button>
        </div>

        <button type="button" onClick={onClose} className="mt-5 text-sm text-ink-2 hover:text-ink">
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}

export default function StartJudgingButton({ className = 'btn-cta text-sm', onNavigate }) {
  const { user, loading } = useAuth()
  const [open, setOpen] = useState(false)
  const [showAuth, setShowAuth] = useState(false)

  function handleClick() {
    onNavigate?.()
    // Judging and submitting are both gated on being signed in, so ask for
    // that first rather than letting someone pick a path and only then
    // discover they can't proceed.
    if (!user) setShowAuth(true)
    else setOpen(true)
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={loading} className={className}>
        Start Judging
      </button>
      {showAuth && (
        <AuthModal
          reason="Sign in to judge tasks or submit a benchmark. Every score and submission is attributed to an account."
          onClose={() => setShowAuth(false)}
          onSuccess={() => {
            setShowAuth(false)
            setOpen(true)
          }}
        />
      )}
      {open && <ChoiceOverlay onClose={() => setOpen(false)} />}
    </>
  )
}

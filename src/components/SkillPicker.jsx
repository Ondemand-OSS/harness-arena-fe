import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { api } from '../api.js'
import { OnDemandMark } from './brandLogos.jsx'

const ONDEMAND_PLAYGROUND_URL = 'https://app.on-demand.io/playground'

function SkillInfoModal({ skill, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4">
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div role="dialog" aria-modal="true" aria-labelledby="skill-info-title" className="card w-full max-w-md p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Skill</p>
              <h2 id="skill-info-title" className="font-display mt-1 text-xl font-semibold">
                {skill.name}
              </h2>
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
          <p className="mt-4 whitespace-pre-wrap text-sm text-ink-2">{skill.description || 'No description.'}</p>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Pick which of the signed-in user's own subscribed OnDemand skills this
 *  run uses  -  extracted into every non-OnDemand harness's workdir, or
 *  sent as `skillNames` straight to OnDemand's own chat API (see
 *  backend/app/ondemand_skills.py and harnesses/ondemand.py).
 *
 *  `onChange(ids, skills)` is called with both the selected ids (what
 *  actually gets submitted) and the full skill objects (so a caller that
 *  wants the names for display  -  see RunRequest.skill_names  -  doesn't
 *  need to re-fetch or re-match them itself). */
export default function SkillPicker({ selectedSkillIds, onChange }) {
  const { user } = useAuth()
  const hasOndemandKey = Boolean(user?.has_ondemand_api_key)
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewingSkill, setViewingSkill] = useState(null)

  const load = useCallback(() => {
    if (!hasOndemandKey) return
    setLoading(true)
    setError('')
    api
      .listOndemandSkills()
      .then(setSkills)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [hasOndemandKey])

  useEffect(() => {
    load()
  }, [load])

  function toggleSkill(id) {
    const nextIds = selectedSkillIds.includes(id) ? selectedSkillIds.filter((item) => item !== id) : [...selectedSkillIds, id]
    onChange(
      nextIds,
      skills.filter((skill) => nextIds.includes(skill.id))
    )
  }

  if (!hasOndemandKey) {
    return (
      <div className="mt-4 border-t border-line pt-4">
        <p className="eyebrow">Skills</p>
        <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink-2" role="status">
          Set your OnDemand API key in Setup to use skills. Make one on{' '}
          <a href={ONDEMAND_PLAYGROUND_URL} target="_blank" rel="noreferrer" className="text-link">
            app.on-demand.io/playground ↗
          </a>{' '}
          then <Link to="/setup" className="text-link">open Setup</Link>.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow flex items-center gap-2">
          Skills
          {selectedSkillIds.length > 0 && (
            <span className="rounded-full bg-cta/20 px-1.5 py-0.5 font-mono-arena text-[10px] text-cta">
              {selectedSkillIds.length} selected
            </span>
          )}
        </p>
        <span className="flex items-center gap-2">
          <span className="text-xs text-ink-3">Added a new skill?</span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            // btn-secondary's own `display: inline-block` (theme.css) beats
            // Tailwind's `flex` class in the cascade, which stacked the icon
            // above the label instead of beside it — the inline style wins.
            style={{ display: 'inline-flex' }}
            className="btn-secondary shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs disabled:opacity-50"
          >
            {loading ? (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-cta" aria-hidden="true" />
            ) : (
              // The mark is a white-only logo meant for a colored chip (see
              // HarnessAvatar) — bare on this button's background it's
              // invisible/looks broken, so it gets the same dark backing here.
              <span
                className="grid h-4 w-4 shrink-0 place-items-center rounded-full"
                style={{ background: '#111111' }}
                aria-hidden="true"
              >
                <OnDemandMark className="h-2.5 w-2.5" />
              </span>
            )}
            {loading ? 'Fetching…' : 'Fetch from OnDemand'}
          </button>
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      {!error && !loading && skills.length === 0 && (
        <p className="mt-2 text-sm text-ink-2">
          No subscribed skills yet. Add one on{' '}
          <a href={ONDEMAND_PLAYGROUND_URL} target="_blank" rel="noreferrer" className="text-link">
            app.on-demand.io/playground ↗
          </a>
          , then Refresh.
        </p>
      )}
      <div className="mt-2 flex max-h-52 flex-wrap gap-2 overflow-y-auto pr-1">
        {skills.map((skill) => {
          const selected = selectedSkillIds.includes(skill.id)
          return (
            <div
              key={skill.id}
              className={`flex h-fit items-center gap-0.5 rounded-full border pl-1 pr-0.5 text-sm transition-colors ${
                selected ? 'border-transparent bg-cta text-on-cta' : 'border-line-strong bg-floating text-ink-2'
              }`}
            >
              <button
                type="button"
                onClick={() => toggleSkill(skill.id)}
                aria-pressed={selected}
                className={`flex min-w-0 items-center gap-1.5 rounded-full py-1.5 pl-2 pr-1 ${selected ? '' : 'hover:bg-elevated'}`}
              >
                <span aria-hidden="true">{selected ? '✓' : '+'}</span>
                <span className="max-w-[14rem] truncate">{skill.name}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewingSkill(skill)}
                aria-label={`View ${skill.name} details`}
                title="View details"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${
                  selected ? 'hover:bg-black/10' : 'hover:bg-elevated'
                }`}
              >
                ⓘ
              </button>
            </div>
          )
        })}
      </div>

      {viewingSkill && <SkillInfoModal skill={viewingSkill} onClose={() => setViewingSkill(null)} />}
    </div>
  )
}

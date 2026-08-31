import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { FAMILY_MARKS } from './brandLogos.jsx'
import { HarnessAvatar, ModelBadge } from './ui.jsx'
import SkillPicker from './SkillPicker.jsx'

// Display order for the admin-curated free-model families  -  mirrors
// backend/app/routers/config.py's FREE_MODEL_FAMILIES. A profile with no
// family (a legacy personal profile) falls outside every group below.
const FAMILY_ORDER = ['deepseek', 'kimi', 'glm', 'minimax', 'qwen']
const FAMILY_LABEL = { deepseek: 'DeepSeek', kimi: 'Kimi', glm: 'GLM', minimax: 'MiniMax', qwen: 'Qwen' }

/** Pick which model profile to run a battle with.
 *
 * Every selected harness runs again, regardless of prior task/model
 * results. Historical runs remain available only as Battle Log history.
 *
 *  OnDemand doesn't fit that shared-profile shape (see
 *  backend/app/harnesses/ondemand.py)  -  it still requires the signed-in
 *  user to have their own OnDemand key set in Setup, but which OnDemand
 *  model it runs is now implied by the chosen free profile's admin-set
 *  mapping (see Setup's "OnDemand mapping" field), not picked here. If the
 *  chosen profile has no mapping, the server rejects the run with a clear
 *  error rather than this modal guessing at one.
 */
export default function ModelPickerModal({ profiles, runs, harnesses, initialHarnessKeys, busy, onSelect, onClose }) {
  const { user } = useAuth()
  const initialKey = initialHarnessKeys.join('|')
  const [harnessKeys, setHarnessKeys] = useState(initialHarnessKeys)
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [harnessNotice, setHarnessNotice] = useState('')
  const [selectedSkillIds, setSelectedSkillIds] = useState([])
  const [selectedSkillNames, setSelectedSkillNames] = useState([])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setHarnessKeys(initialHarnessKeys)
    setSelectedProfileId(null)
  }, [initialKey])

  function toggleHarness(key) {
    setHarnessKeys((selected) => (selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]))
  }

  const hasOndemandKey = Boolean(user?.has_ondemand_api_key)

  useEffect(() => {
    if (!hasOndemandKey) setHarnessKeys((selected) => selected.filter((key) => key !== 'ondemand'))
  }, [hasOndemandKey])

  function statusFor(profile) {
    return { disabled: false, note: '' }
  }

  // Grouped by family (deepseek / kimi / glm / minimax / qwen) so picking a
  // model is "choose a family, then a specific model within it" rather than
  // one long flat list. A legacy personal (non-free, no family) profile -
  // BYOK creation is on hold, but an old one can still exist and be picked -
  // falls into its own trailing "Other" group instead of being dropped.
  const familyGroups = FAMILY_ORDER.map((family) => ({
    family,
    label: FAMILY_LABEL[family],
    items: profiles.filter((p) => p.family === family),
  })).filter((g) => g.items.length > 0)
  const otherProfiles = profiles.filter((p) => !FAMILY_ORDER.includes(p.family))
  const profileGroups = [...familyGroups, ...(otherProfiles.length ? [{ family: 'other', label: 'Other', items: otherProfiles }] : [])]

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4">
      {/* `fixed`, not `absolute`: this button's containing block would
          otherwise be sized to one viewport-height (the outer `fixed`
          wrapper's own box), not the full scrollable content — with as many
          model profiles as this dialog can list, scrolling past that one
          viewport left the backdrop behind and the real page showed through
          around the lower part of the dialog (including the Submit row). */}
      <button type="button" className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div role="dialog" aria-modal="true" aria-labelledby="model-picker-title" className="card w-full max-w-lg p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Choose a model</p>
              <h2 id="model-picker-title" className="font-display mt-1 text-2xl font-semibold">
                Choose harnesses and model
              </h2>
              <p className="mt-2 text-sm text-ink-2">
                Select the harnesses for this run, then choose one shared model. At least two harnesses are required
                for a comparison.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 -mt-2 grid h-9 w-9 shrink-0 place-items-center rounded text-xl leading-none text-ink-2 hover:bg-elevated hover:text-ink"
              aria-label="Close model picker"
            >
              ×
            </button>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow">Harnesses to run</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {harnesses.map((harness) => {
                const selected = harnessKeys.includes(harness.key)
                const ondemandBlocked = harness.key === 'ondemand' && !hasOndemandKey
                return (
                  <button
                    key={harness.key}
                    type="button"
                    onClick={() => {
                      if (ondemandBlocked) {
                        setHarnessNotice('Set your OnDemand API key in Setup before selecting OnDemand.')
                        return
                      }
                      toggleHarness(harness.key)
                    }}
                    aria-pressed={selected}
                    aria-disabled={ondemandBlocked}
                    title={ondemandBlocked ? 'Set your OnDemand API key in Setup to unlock this harness.' : undefined}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      ondemandBlocked ? 'cursor-not-allowed border-line-strong bg-floating text-ink-2' : selected ? 'border-transparent bg-cta text-on-cta' : 'border-line-strong bg-floating text-ink-2 hover:bg-elevated'
                    }`}
                  >
                    <span aria-hidden="true">{selected ? '✓' : '+'}</span>
                    <HarnessAvatar harnessKey={harness.key} name={harness.name} size={18} />
                    {harness.name}
                  </button>
                )
              })}
            </div>
            {(harnessNotice || !hasOndemandKey) && (
              <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink-2" role="status">
                {harnessNotice || 'Set your OnDemand API key in Setup before selecting OnDemand.'}
                <Link to="/setup" className="btn-secondary px-2 py-1 text-xs" onClick={onClose}>
                  Open Setup
                </Link>
              </p>
            )}
            <p className={`mt-2 text-xs ${harnessKeys.length >= 2 ? 'text-ink-3' : 'text-warn'}`}>
              {harnessKeys.length} selected. Select at least 2 harnesses to continue.
            </p>
          </div>

          <SkillPicker
            selectedSkillIds={selectedSkillIds}
            onChange={(ids, skills) => {
              setSelectedSkillIds(ids)
              setSelectedSkillNames(skills.map((skill) => skill.name))
            }}
          />

          {/* Which OnDemand model a run uses is no longer picked here  -  it's
              implied by the free profile chosen below, via the admin's
              mapping set in Setup. Only the "have you set an OnDemand key at
              all" gate (the harness-selection banner above) still applies. */}

          <div className="mt-4 space-y-4">
            {profileGroups.map((group) => (
              <div key={group.family}>
                <p className="eyebrow mb-2 flex items-center gap-1.5">
                  {FAMILY_MARKS[group.family] && (
                    <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-sm">
                      {(() => {
                        const FamilyMark = FAMILY_MARKS[group.family]
                        return <FamilyMark className="h-full w-full" />
                      })()}
                    </span>
                  )}
                  {group.label}
                </p>
                <div className="space-y-2">
                  {group.items.map((profile) => {
                    const { disabled, note } = statusFor(profile)
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        disabled={disabled || busy || harnessKeys.length < 2}
                        onClick={() => setSelectedProfileId(profile.id)}
                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                          disabled || busy || harnessKeys.length < 2
                            ? 'cursor-not-allowed border-line bg-floating opacity-50'
                            : selectedProfileId === profile.id
                              ? 'border-cta bg-cta/10'
                              : 'border-line bg-floating hover:bg-elevated'
                        }`}
                        aria-pressed={selectedProfileId === profile.id}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{profile.name}</span>
                            {profile.is_free && (
                              <>
                                <span className="rounded bg-cta/20 px-1.5 py-0.5 font-mono-arena text-[10px] uppercase text-cta">
                                  free tier
                                </span>
                                <span className="font-mono-arena text-[10px] uppercase text-ink-3">Sponsored by OnDemand</span>
                              </>
                            )}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2">
                            <ModelBadge model={profile.model} />
                            {note && <span className="text-xs text-ink-3">{note}</span>}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {profiles.length === 0 && (
              <p className="text-sm text-ink-2">
                No model profiles available yet. Add one in Setup, or wait for a free-tier profile to be published.
              </p>
            )}
          </div>
          <div className="mt-5 flex justify-end border-t border-line pt-4">
            <button
              type="button"
              className="btn-cta text-sm disabled:opacity-50"
              disabled={busy || harnessKeys.length < 2 || selectedProfileId == null}
              onClick={() => onSelect(selectedProfileId, harnessKeys, selectedSkillIds, selectedSkillNames)}
            >
              {busy ? 'Submitting…' : 'Submit run'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

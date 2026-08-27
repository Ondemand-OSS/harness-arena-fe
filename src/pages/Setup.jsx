import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import AuthModal from '../components/AuthModal.jsx'
import { IconEye, IconEyeOff } from '../components/icons.jsx'
import { LoadingState, ModelBadge, PageHeader } from '../components/ui.jsx'

const ONDEMAND_PLAYGROUND_URL = 'https://app.on-demand.io/playground'
const ONDEMAND_AUTH_DOCS_URL = 'https://docs.on-demand.io/docs/authentication'
const CATEGORY_GROUPS = ['Code', 'Research', 'Analysis & Risk', 'Operations', 'Other']

/** OnDemand's own authentication docs aren't embeddable here (external
 *  sites routinely block framing via X-Frame-Options/CSP, and this app has
 *  no way to know in advance whether that one does)  -  so rather than a
 *  silently-blank iframe, this is a small explainer with the two real links
 *  people actually need, in the same portal-modal pattern AuthModal uses. */
function OndemandHelpModal({ onClose }) {
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
        <div role="dialog" aria-modal="true" aria-labelledby="ondemand-help-title" className="card w-full max-w-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">OnDemand API key</p>
              <h2 id="ondemand-help-title" className="font-display mt-1 text-2xl font-semibold">
                Getting set up
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
          <ol className="mt-4 list-decimal space-y-3 pl-4 text-sm text-ink-2">
            <li>
              Open the OnDemand Playground and generate a key there:{' '}
              <a href={ONDEMAND_PLAYGROUND_URL} target="_blank" rel="noreferrer" className="text-link">
                app.on-demand.io/playground ↗
              </a>
            </li>
            <li>
              Full authentication details (scopes, header format) are in OnDemand's own docs:{' '}
              <a href={ONDEMAND_AUTH_DOCS_URL} target="_blank" rel="noreferrer" className="text-link">
                docs.on-demand.io ↗
              </a>
            </li>
            <li>Paste the key into the field below and save  -  it's yours alone, never shared with other users.</li>
          </ol>
        </div>
      </div>
    </div>,
    document.body
  )
}

const FIELD = 'w-full rounded border border-line-strong bg-floating px-3 py-2 text-sm'
function CategoryReviewCard() {
  const [reviews, setReviews] = useState([])
  const [groups, setGroups] = useState({})
  const [savedGroups, setSavedGroups] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listCategoryReviews()
      .then((items) => {
        setReviews(items)
        setSavedGroups(Object.fromEntries(items.filter((item) => item.status === 'approved' && item.group).map((item) => [item.key, item.group])))
      })
      .catch((err) => setError(err.message))
  }, [])

  async function approve(review) {
    const group = groups[review.key] ?? review.group
    if (!group) return
    setError('')
    try {
      await api.approveCategoryReview(review.key, group)
      setReviews((current) => current.map((item) => (item.key === review.key ? { ...item, status: 'approved', group } : item)))
      setSavedGroups((current) => ({ ...current, [review.key]: group }))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="card space-y-3 p-5">
      <div>
        <p className="eyebrow">Admin review</p>
        <h2 className="font-display mt-1 text-lg font-semibold">Uploaded categories</h2>
        <p className="mt-1 text-sm text-ink-2">Choose where an approved category belongs. It will then appear by name in that group’s filters.</p>
      </div>
      {reviews.map((review) => {
        const selectedGroup = groups[review.key] ?? review.group ?? ''
        const saved = savedGroups[review.key] === selectedGroup
        return (
          <div key={review.key} className="flex flex-wrap items-center gap-2 rounded border border-line bg-floating p-3">
            <span className="min-w-0 flex-1 text-sm font-medium text-ink">
              {review.category} <span className="font-mono-arena text-[10px] text-ink-3">· {review.task_count} tasks · {review.status}</span>
            </span>
            {saved && <span className="text-xs text-good" role="status">Saved to {selectedGroup}</span>}
            <select
              className="rounded border border-line-strong bg-floating px-2 py-1.5 text-sm"
              value={selectedGroup}
              onChange={(event) => setGroups((current) => ({ ...current, [review.key]: event.target.value }))}
              aria-label={`Group for ${review.category}`}
            >
              <option value="" disabled>Choose group</option>
              {CATEGORY_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
            </select>
            <button
              type="button"
              className="btn-cta text-sm disabled:opacity-50"
              disabled={!selectedGroup || saved}
              onClick={() => approve(review)}
            >
              {saved ? 'Saved' : review.status === 'approved' ? 'Save group' : 'Approve'}
            </button>
          </div>
        )
      })}
      {!reviews.length && !error && <p className="text-sm text-ink-3">No uploaded categories need review.</p>}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  )
}

function UserLimitsCard() {
  const [users, setUsers] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [dailyLimit, setDailyLimit] = useState('10')
  const [activeLimit, setActiveLimit] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    api.listUserLimitOverrides().then((items) => {
      setUsers(items)
      if (items[0]) selectUser(items[0], items)
    }).catch((err) => setError(err.message))
  }, [])

  function selectUser(user, source = users) {
    const current = source.find((item) => item.id === user.id) || user
    setSelectedId(String(current.id))
    setDailyLimit(String(current.task_submission_limit ?? 10))
    setActiveLimit(String(current.max_active_tasks ?? 1))
    setSaved('')
  }

  async function save() {
    const user = users.find((item) => String(item.id) === selectedId)
    if (!user) return
    const taskSubmissionLimit = Number(dailyLimit)
    const maxActiveTasks = Number(activeLimit)
    if (!Number.isInteger(taskSubmissionLimit) || taskSubmissionLimit < 1 || !Number.isInteger(maxActiveTasks) || maxActiveTasks < 1) {
      setError('Both limits must be whole numbers of at least 1.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await api.updateUserLimitOverride(user.id, {
        task_submission_limit: taskSubmissionLimit,
        max_active_tasks: maxActiveTasks,
      })
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setSaved(`${updated.display_name}'s limits saved.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div>
        <p className="eyebrow">Admin controls</p>
        <h2 className="font-display mt-1 text-lg font-semibold">User task limits</h2>
        <p className="mt-1 text-sm text-ink-2">Set higher rolling 24-hour task limits and simultaneous active tasks for an individual user. The normal limits are 10 tasks and 1 active task.</p>
      </div>
      {users.length > 0 ? (
        <>
          <label className="block text-sm font-medium text-ink">
            User
            <select className={`${FIELD} mt-1`} value={selectedId} onChange={(event) => selectUser(users.find((user) => user.id === Number(event.target.value)))}>
              {users.map((user) => <option key={user.id} value={user.id}>{user.display_name} (@{user.username})</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Tasks per 24 hours
              <input className={`${FIELD} mt-1`} type="number" min="1" max="1000" value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} />
            </label>
            <label className="text-sm font-medium text-ink">
              Concurrent active tasks
              <input className={`${FIELD} mt-1`} type="number" min="1" max="100" value={activeLimit} onChange={(event) => setActiveLimit(event.target.value)} />
            </label>
          </div>
          <button type="button" className="btn-cta text-sm disabled:opacity-50" disabled={saving || !selectedId} onClick={save}>
            {saving ? 'Saving…' : 'Save user limits'}
          </button>
        </>
      ) : (
        <p className="text-sm text-ink-3">No regular user accounts yet.</p>
      )}
      {saved && <p className="text-sm text-good" role="status">{saved}</p>}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  )
}

function LoginGate() {
  const [showAuth, setShowAuth] = useState(false)
  return (
    <>
      <div className="mx-auto max-w-sm">
        <div className="card space-y-4 p-6">
          <div>
            <p className="eyebrow">Account required</p>
            <h1 className="font-display mt-1 text-2xl font-semibold">Sign in to Setup</h1>
            <p className="mt-2 text-sm text-ink-2">
              Create an account or sign in to manage model profiles and harness settings.
            </p>
          </div>
          <button type="button" className="btn-cta w-full text-sm" onClick={() => setShowAuth(true)}>
            Sign in or create an account
          </button>
        </div>
      </div>
      {showAuth && (
        <AuthModal
          reason="Sign in to manage model profiles and harness settings."
          onClose={() => setShowAuth(false)}
        />
      )}
    </>
  )
}

// Admin-only, free-profile-only  -  forwarded to whichever model provider
// (OpenRouter etc.) the profile talks to. Left blank, the arena applies its
// own default (see backend/app/routers/config.py's DEFAULT_FREE_REASONING_EFFORT).
const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Fixed set of model families a free profile can belong to  -  mirrors
// backend/app/routers/config.py's FREE_MODEL_FAMILIES exactly. Required on
// every free profile; empty/ignored for personal ones.
const FREE_MODEL_FAMILIES = ['deepseek', 'kimi', 'glm', 'minimax', 'qwen']

function ConfigForm({ initial, isAdmin, ondemandModels, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial ?? {
      name: '',
      model: '',
      base_url: '',
      api_key: '',
      is_free: false,
      reasoning_effort: '',
      family: '',
      ondemand_model_id: null,
    }
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSave(form)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line pt-4">
      <input
        className={FIELD}
        placeholder="Profile name, e.g. DeepSeek V4 via OpenRouter"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        required
      />
      <input
        className={FIELD}
        placeholder="Model id, e.g. deepseek-v4, claude-opus-4-6"
        value={form.model}
        onChange={(e) => setForm({ ...form, model: e.target.value })}
        required
      />
      <input
        className={`${FIELD} font-mono-arena text-xs`}
        placeholder="https://api.your-provider.com/v1"
        value={form.base_url}
        onChange={(e) => setForm({ ...form, base_url: e.target.value })}
        required
      />
      <input
        type="password"
        className={`${FIELD} font-mono-arena text-xs`}
        placeholder={initial ? 'API key. Leave blank to keep the stored one' : 'API key'}
        value={form.api_key}
        onChange={(e) => setForm({ ...form, api_key: e.target.value })}
      />
      {isAdmin && (
        <div className="space-y-1 rounded border border-line-strong bg-floating p-3">
          <p className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">OnDemand admin only</p>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={form.is_free}
              onChange={(e) => setForm({ ...form, is_free: e.target.checked })}
            />
            Free model. Available to every user; OnDemand pays the API cost
          </label>
          <p className="text-xs text-ink-3">When this is off, the profile is private to your account.</p>
          {form.is_free && (
            <>
              <label className="flex items-center gap-2 pt-1 text-sm text-ink-2">
                Family
                <select
                  className="rounded border border-line-strong bg-floating px-2 py-1 text-sm"
                  value={form.family ?? ''}
                  onChange={(e) => setForm({ ...form, family: e.target.value })}
                  required
                >
                  <option value="" disabled>
                    select a family…
                  </option>
                  {FREE_MODEL_FAMILIES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 pt-1 text-sm text-ink-2">
                OnDemand mapping
                <select
                  className="rounded border border-line-strong bg-floating px-2 py-1 text-sm"
                  value={form.ondemand_model_id ?? ''}
                  onChange={(e) => setForm({ ...form, ondemand_model_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">none yet</option>
                  {(ondemandModels ?? []).filter((m) => m.enabled !== false).map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-ink-3">
                Which OnDemand model this free profile resolves to when a battle includes OnDemand alongside other
                harnesses. Leave unset if OnDemand shouldn't be usable with this model yet.
              </p>
              <label className="flex items-center gap-2 pt-1 text-sm text-ink-2">
                Reasoning effort
                <select
                  className="rounded border border-line-strong bg-floating px-2 py-1 text-sm"
                  value={form.reasoning_effort ?? ''}
                  onChange={(e) => setForm({ ...form, reasoning_effort: e.target.value })}
                >
                  <option value="">default (medium)</option>
                  {REASONING_EFFORTS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 pt-1">
        <button type="submit" className="btn-cta text-sm" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Add model key'}
        </button>
        <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  )
}

function ProfileRow({ c, isAdmin, ondemandModels, editingId, setEditingId, guard, refresh }) {
  const canManage = c.is_owned_by_me || (c.is_free && isAdmin)
  // Editing a profile always sends is_free back to the server, and the
  // backend now 403s any is_free:false create/update  -  personal profiles
  // are temporarily unowned/frozen (can still be deleted, just not edited).
  // Restore `canManage && !c.is_free` (or just `canManage`) once BYOK edits
  // come back.
  const canEdit = canManage && c.is_free

  return (
    <div className="py-3 first:pt-0">
      {editingId === c.id ? (
        <ConfigForm
          isAdmin={isAdmin}
          ondemandModels={ondemandModels}
          initial={{
            name: c.name,
            model: c.model,
            base_url: c.base_url,
            api_key: '',
            is_free: c.is_free,
            reasoning_effort: c.reasoning_effort ?? '',
            family: c.family ?? '',
            ondemand_model_id: c.ondemand_model_id ?? null,
          }}
          onSave={async (form) => {
            await api.updateConfig(c.id, form)
            setEditingId(null)
            refresh()
          }}
          onCancel={() => setEditingId(null)}
        />
      ) : (
        <div className={`flex items-center justify-between gap-3 ${c.is_free && c.enabled === false ? 'opacity-50' : ''}`}>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <span className="truncate">{c.name}</span>
              {c.is_free && (
                <span className="shrink-0 rounded bg-cta/20 px-1.5 py-0.5 font-mono-arena text-[10px] uppercase text-cta">
                  free tier
                </span>
              )}
              {c.is_free && c.enabled === false && (
                <span className="shrink-0 rounded bg-bad/20 px-1.5 py-0.5 font-mono-arena text-[10px] uppercase text-bad">
                  disabled
                </span>
              )}
            </p>
            {/* Free profiles are shared, admin-funded choices. Their raw
                provider endpoint, API-key state, and internal model slug
                are implementation details, not information for other
                users. The arena admin still sees them while managing the
                profile. */}
            {(!c.is_free || isAdmin) && (
              <p className="mt-1 flex items-center gap-1.5 truncate font-mono-arena text-[11px] text-ink-3">
                <ModelBadge model={c.model} />
                <span className="truncate">
                  {c.base_url} · {c.has_api_key ? 'key saved' : 'no key'}
                </span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs">
            {isAdmin && c.is_free && (
              <label className="flex items-center gap-1.5 text-ink-2">
                <input
                  type="checkbox"
                  checked={c.enabled !== false}
                  onChange={(e) => guard(() => api.setConfigEnabled(c.id, e.target.checked))}
                  aria-label={`Enabled: ${c.name}`}
                />
                Enabled
              </label>
            )}
            {canManage && (
              <>
                {/* Editing a personal (non-free) profile now 403s server-side
                    too  -  see canEdit above. Restore `canManage` alone once
                    BYOK edits come back. */}
                {canEdit && (
                  <button type="button" className="text-ink-2 hover:text-ink" onClick={() => setEditingId(c.id)}>
                    edit
                  </button>
                )}
                <button type="button" className="text-bad" onClick={() => guard(() => api.deleteConfig(c.id))}>
                  remove
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProviderProfiles() {
  const { isAdminMode } = useAuth()
  const isAdmin = isAdminMode
  const [configs, setConfigs] = useState([])
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  // Only visible to the admin (the server sends null to everyone else) - used
  // to populate the free-profile form's OnDemand-mapping dropdown below.
  const [ondemandModels, setOndemandModels] = useState([])

  function refresh() {
    api.listConfigs().then(setConfigs).catch((e) => setError(e.message))
  }

  useEffect(refresh, [])
  useEffect(() => {
    if (isAdmin) api.listOndemandModels().then(setOndemandModels).catch(() => {})
  }, [isAdmin])

  async function guard(fn) {
    setError('')
    try {
      await fn()
      refresh()
    } catch (e) {
      setError(e.message)
    }
  }

  const mine = configs.filter((c) => !c.is_free && c.is_owned_by_me)
  const freeModels = configs.filter((c) => c.is_free)

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">Model &amp; provider profiles</h2>
        <p className="mt-1 text-sm text-ink-2">
          Pick the model to use each time you trigger a battle or submit a benchmark. Holding the model constant
          across harnesses makes the comparison about the harness rather than the model.
        </p>
      </div>

      {/* "Bring your own OpenRouter key" personal profiles are temporarily
          disabled  -  creating/editing one now 403s server-side for everyone,
          admin included (backend/app/routers/config.py). The arena runs on
          the admin's free models only for now; regular users just pick one
          in the battle flow, they no longer manage a profile of their own.
          `mine` (any legacy personal profiles this account still owns) is
          kept around only so ProfileRow can still offer "remove" on them -
          restore this whole section (and the list header) once BYOK is
          re-enabled.
      <div>
        <p className="eyebrow mb-1">My profiles</p>
        <div className="divide-y divide-line">
          {mine.map((c) => (
            <ProfileRow key={c.id} c={c} isAdmin={isAdmin} ondemandModels={ondemandModels} editingId={editingId} setEditingId={setEditingId} guard={guard} refresh={refresh} />
          ))}
          {mine.length === 0 && <p className="text-xs text-ink-3">No personal profiles yet. Add one below.</p>}
        </div>
      </div>
      */}
      {mine.length > 0 && (
        <div>
          <p className="eyebrow mb-1">My profiles</p>
          <p className="text-xs text-ink-3">
            Personal, bring-your-own-key profiles are on hold for now  -  these can still be removed, but no longer
            edited.
          </p>
          <div className="divide-y divide-line">
            {mine.map((c) => (
              <ProfileRow key={c.id} c={c} isAdmin={isAdmin} ondemandModels={ondemandModels} editingId={editingId} setEditingId={setEditingId} guard={guard} refresh={refresh} />
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="eyebrow mb-1">Free models</p>
        <p className="text-xs text-ink-3">
          Funded by OnDemand. No API key of your own required. Available to every signed-in user.
        </p>
        <div className="divide-y divide-line">
          {freeModels.map((c) => (
            <ProfileRow key={c.id} c={c} isAdmin={isAdmin} ondemandModels={ondemandModels} editingId={editingId} setEditingId={setEditingId} guard={guard} refresh={refresh} />
          ))}
          {freeModels.length === 0 && (
            <p className="text-xs text-ink-3">
              {isAdmin ? 'None yet. Add one below and check “Free model”.' : 'None set up yet.'}
            </p>
          )}
        </div>
      </div>

      {/* Creating a new profile is admin-only now too: a non-admin can only
          ever submit is_free:false (they can't check "Free model" - that
          checkbox is itself admin-gated above), and personal profiles are
          blocked server-side for everyone. Restore this for non-admins once
          BYOK is re-enabled.
      {adding ? (
        <ConfigForm
          isAdmin={isAdmin}
          onSave={async (form) => {
            await api.createConfig(form)
            setAdding(false)
            refresh()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="btn-secondary text-sm" onClick={() => setAdding(true)}>
          + Add model key
        </button>
      )}
      */}
      {isAdmin && (
        adding ? (
          <ConfigForm
            isAdmin={isAdmin}
            ondemandModels={ondemandModels}
            onSave={async (form) => {
              await api.createConfig(form)
              setAdding(false)
              refresh()
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" className="btn-secondary text-sm" onClick={() => setAdding(true)}>
            + Add model key
          </button>
        )
      )}

      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  )
}

function OndemandModelForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial ?? { label: '', endpoint_id: '', reasoning_effort: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSave(form)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line pt-4">
      <input
        className={FIELD}
        placeholder="Label, e.g. DeepSeek V4 Flash"
        value={form.label}
        onChange={(e) => setForm({ ...form, label: e.target.value })}
        required
      />
      <input
        className={`${FIELD} font-mono-arena text-xs`}
        placeholder="OnDemand endpoint id, e.g. predefined-deepseek-v4-flash"
        value={form.endpoint_id}
        onChange={(e) => setForm({ ...form, endpoint_id: e.target.value })}
        required
      />
      {/* Admin-only, and never surfaced to a regular user picking a model
          to run  -  see backend/app/routers/ondemand_models.py's `_out`. */}
      <label className="flex items-center gap-2 pt-1 text-sm text-ink-2">
        Reasoning effort
        <select
          className="rounded border border-line-strong bg-floating px-2 py-1 text-sm"
          value={form.reasoning_effort ?? ''}
          onChange={(e) => setForm({ ...form, reasoning_effort: e.target.value })}
        >
          <option value="">default (max)</option>
          {REASONING_EFFORTS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3 pt-1">
        <button type="submit" className="btn-cta text-sm" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Add model'}
        </button>
        <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  )
}

/** OnDemand doesn't fit the shared-provider-profile model every other
 *  harness uses: it runs on the signed-in user's OWN OnDemand key, and its
 *  "model" is one of a small admin-curated whitelist (the API only accepts
 *  specific predefined endpoint ids, not free text)  -  see
 *  backend/app/harnesses/ondemand.py. */
function OndemandCard() {
  const { user, setUser, isAdminMode } = useAuth()
  const [apiKey, setApiKey] = useState('')
  const [revealKey, setRevealKey] = useState(false)
  const savedKey = Boolean(user?.has_ondemand_api_key)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [editingKey, setEditingKey] = useState(false)

  const [models, setModels] = useState([])
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [modelsError, setModelsError] = useState('')

  function refreshModels() {
    api.listOndemandModels().then(setModels).catch((e) => setModelsError(e.message))
  }

  useEffect(refreshModels, [])

  // null while loading, so the checkbox doesn't flash "off" before the
  // real (currently off-by-default) value comes back.
  const [suggestPlugins, setSuggestPlugins] = useState(null)
  const [suggestPluginsBusy, setSuggestPluginsBusy] = useState(false)
  const [suggestPluginsError, setSuggestPluginsError] = useState('')

  useEffect(() => {
    // Admin-only endpoint — a non-admin viewer never sees this setting or
    // the checkbox it feeds, so there's nothing to fetch for them.
    if (!isAdminMode) return
    api.getOndemandSuggestPlugins().then((d) => setSuggestPlugins(d.enabled)).catch(() => {})
  }, [isAdminMode])

  async function toggleSuggestPlugins(enabled) {
    setSuggestPluginsBusy(true)
    setSuggestPluginsError('')
    try {
      const updated = await api.setOndemandSuggestPlugins(enabled)
      setSuggestPlugins(updated.enabled)
    } catch (e) {
      setSuggestPluginsError(e.message)
    } finally {
      setSuggestPluginsBusy(false)
    }
  }

  async function saveKey(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const updated = await api.setOndemandApiKey(apiKey)
      setUser((prev) => ({ ...prev, ...updated }))
      setApiKey('')
      setRevealKey(false)
      setEditingKey(false)
      setStatus(updated.has_ondemand_api_key ? 'OnDemand API key saved.' : 'OnDemand API key cleared.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function guardModels(fn) {
    setModelsError('')
    try {
      await fn()
      refreshModels()
    } catch (e) {
      setModelsError(e.message)
    }
  }

  async function deleteKey() {
    if (!window.confirm('Delete your saved OnDemand API key?')) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const updated = await api.setOndemandApiKey('')
      setUser((prev) => ({ ...prev, ...updated }))
      setEditingKey(false)
      setStatus('OnDemand API key deleted.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold">{savedKey ? 'OnDemand API key' : 'OnDemand'}</h2>
            {savedKey && <span className="text-sm text-good">Saved</span>}
          </div>
          {!savedKey && (
            <p className="mt-1 text-sm text-ink-2">
              OnDemand runs on your own OnDemand API key, not a provider profile above.{' '}
              <button type="button" className="text-link" onClick={() => setShowHelp(true)}>
                How do I set this up?
              </button>
            </p>
          )}
        </div>
        {savedKey && !editingKey && (
          <div className="flex items-center gap-3 text-sm">
            <button type="button" className="text-link" onClick={() => setEditingKey(true)}>Edit</button>
            <button type="button" className="text-bad hover:underline" disabled={busy} onClick={deleteKey}>Delete</button>
          </div>
        )}
      </div>

      {showHelp && <OndemandHelpModal onClose={() => setShowHelp(false)} />}

      {(!savedKey || editingKey) && <form onSubmit={saveKey} className="space-y-2">
        <div className="relative">
          <input
            type={revealKey ? 'text' : 'password'}
            className={`${FIELD} font-mono-arena text-xs pr-9`}
            // The server never echoes a stored key back, so editing always
            // starts with an empty field and replaces the stored value.
            placeholder={savedKey ? 'Enter a replacement OnDemand API key' : 'OnDemand API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setRevealKey((v) => !v)}
            disabled={!apiKey}
            className="absolute inset-y-0 right-0 grid w-9 place-items-center text-ink-3 hover:text-ink disabled:opacity-40"
            aria-label={revealKey ? 'Hide key' : 'Show key'}
            title={apiKey ? (revealKey ? 'Hide key' : 'Show key') : 'Type a key to reveal it'}
          >
            {revealKey ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-cta text-sm" disabled={busy}>
            {busy ? 'Saving…' : savedKey ? 'Save changes' : 'Save key'}
          </button>
          {savedKey && (
            <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={() => { setEditingKey(false); setApiKey('') }}>
              Cancel
            </button>
          )}
          {!savedKey && <span className="text-xs text-ink-3">no key set</span>}
        </div>
      </form>}

      {status && <p className="text-sm text-good">{status}</p>}
      {error && <p className="text-sm text-bad">{error}</p>}

      <div className="border-t border-line pt-4">
        <p className="eyebrow mb-1">OnDemand models</p>
        <div className="mt-2 divide-y divide-line">
          {models.map((m) => (
            <div key={m.id} className={`py-2.5 first:pt-2 ${isAdminMode && m.enabled === false ? 'opacity-50' : ''}`}>
              {editingId === m.id ? (
                <OndemandModelForm
                  initial={{ label: m.label, endpoint_id: m.endpoint_id, reasoning_effort: m.reasoning_effort ?? '' }}
                  onSave={async (form) => {
                    await api.updateOndemandModel(m.id, form)
                    setEditingId(null)
                    refreshModels()
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{m.label}</p>
                      {isAdminMode && m.enabled === false && (
                        <span className="rounded bg-elevated px-1.5 py-0.5 font-mono-arena text-[9px] uppercase tracking-wider text-ink-3">disabled</span>
                      )}
                    </div>
                    {isAdminMode && <p className="truncate font-mono-arena text-[11px] text-ink-3">{m.endpoint_id}</p>}
                  </div>
                  {isAdminMode && (
                    <div className="flex shrink-0 items-center gap-3 text-xs">
                      <label className="flex items-center gap-1.5 text-ink-2" title="Disabled models cannot be used for new OnDemand runs">
                        <input
                          type="checkbox"
                          checked={m.enabled !== false}
                          onChange={(e) => guardModels(() => api.setOndemandModelEnabled(m.id, e.target.checked))}
                        />
                        enabled
                      </label>
                      <button type="button" className="text-ink-2 hover:text-ink" onClick={() => setEditingId(m.id)}>
                        edit
                      </button>
                      <button type="button" className="text-bad" onClick={() => guardModels(() => api.deleteOndemandModel(m.id))}>
                        remove
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {models.length === 0 && (
            <p className="text-xs text-ink-3">{isAdminMode ? 'None yet. Add one below.' : 'None set up yet.'}</p>
          )}
        </div>

        {isAdminMode && (
          <div className="mt-3">
            {adding ? (
              <OndemandModelForm
                onSave={async (form) => {
                  await api.createOndemandModel(form)
                  setAdding(false)
                  refreshModels()
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button type="button" className="btn-secondary text-sm" onClick={() => setAdding(true)}>
                + Add OnDemand model
              </button>
            )}
          </div>
        )}
        {modelsError && <p className="mt-2 text-sm text-bad">{modelsError}</p>}
      </div>

      {isAdminMode && (
        <div className="border-t border-line pt-4">
          <p className="eyebrow mb-1">Admin controls</p>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={Boolean(suggestPlugins)}
              disabled={suggestPlugins === null || suggestPluginsBusy}
              onChange={(e) => toggleSuggestPlugins(e.target.checked)}
            />
            Suggest task-specific plugins
          </label>
          <p className="mt-1 text-xs text-ink-3">
            Adds extra agents on top of the default crew based on each task's prompt. Off by default —
            suggestions have named agents unrelated to the task that turn out inactive on OnDemand's side,
            failing the run.
          </p>
          {suggestPluginsError && <p className="mt-1 text-xs text-bad">{suggestPluginsError}</p>}
        </div>
      )}
    </div>
  )
}

function BringYourOwnHarnessComingSoon() {
  return (
    <div className="card space-y-2 p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-lg font-semibold">Bring your own harness</h2>
        <span className="rounded bg-elevated px-1.5 py-0.5 font-mono-arena text-[10px] uppercase text-ink-3">
          coming soon
        </span>
      </div>
      <p className="text-sm text-ink-2">
        Registering a webhook-backed harness, any HTTP endpoint that accepts a task and returns deliverables, is
        being held back for now. The API and adapter already exist; the Setup flow for it will follow.
      </p>
    </div>
  )
}

// Kept for when the feature above is re-enabled  -  a full add/edit/remove
// flow for webhook-backed harnesses, already wired to a working API
// (backend/app/routers/harnesses.py's /custom endpoints).
// eslint-disable-next-line no-unused-vars
function CustomHarnesses() {
  const empty = {
    key: '',
    name: '',
    tagline: '',
    webhook_url: '',
    auth_header: 'Authorization',
    auth_token: '',
  }
  const [harnesses, setHarnesses] = useState([])
  const [form, setForm] = useState(empty)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  function refresh() {
    api.listCustomHarnesses().then(setHarnesses).catch(() => {})
  }

  useEffect(refresh, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      await api.createCustomHarness(form)
      setForm(empty)
      setShowForm(false)
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">Bring your own harness</h2>
        <p className="mt-1 text-sm text-ink-2">
          Register an HTTP endpoint that accepts a task and returns deliverable files. It competes and is judged
          exactly like the built-in harnesses.
        </p>
      </div>

      <p className="rounded-lg border border-line-strong bg-floating p-3 text-xs text-bad">
        The model profile selected for the run, including its API key, is POSTed to this URL so the harness can use
        the same model as everything else. Only register a webhook you trust or control.
      </p>

      <div className="divide-y divide-line">
        {harnesses.map((h) => (
          <div key={h.key} className="flex items-center justify-between gap-3 py-2 first:pt-0">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{h.name}</p>
              <p className="truncate font-mono-arena text-[11px] text-ink-3">{h.webhook_url}</p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-bad"
              onClick={async () => {
                try {
                  await api.deleteCustomHarness(h.key)
                  refresh()
                } catch (err) {
                  setError(err.message)
                }
              }}
            >
              remove
            </button>
          </div>
        ))}
        {harnesses.length === 0 && <p className="text-xs text-ink-3">No custom harnesses registered yet.</p>}
      </div>

      {showForm ? (
        <form onSubmit={submit} className="space-y-2 border-t border-line pt-4">
          <input
            className={FIELD}
            placeholder="key, lowercase slug, e.g. aider-remote"
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            required
          />
          <input
            className={FIELD}
            placeholder="Display name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className={FIELD}
            placeholder="Tagline (optional)"
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
          />
          <input
            className={`${FIELD} font-mono-arena text-xs`}
            placeholder="https://your-service.example.com/run"
            value={form.webhook_url}
            onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
            required
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className={`${FIELD} sm:w-1/3`}
              placeholder="Auth header"
              value={form.auth_header}
              onChange={(e) => setForm({ ...form, auth_header: e.target.value })}
            />
            <input
              type="password"
              className={`${FIELD} font-mono-arena text-xs sm:flex-1`}
              placeholder="Auth token value"
              value={form.auth_token}
              onChange={(e) => setForm({ ...form, auth_token: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button type="submit" className="btn-cta text-sm">
              Register
            </button>
            <button type="button" className="text-sm text-ink-2 hover:text-ink" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-secondary text-sm" onClick={() => setShowForm(true)}>
          + Add custom harness
        </button>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  )
}

export default function Setup() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingState label="Loading setup…" />
  if (!user) return <LoginGate />

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Setup"
      >
        <p>
          Model profiles and harness registration. Loading datasets and running benchmarks lives in{' '}
          <Link to="/benchmark" className="text-link">
            Benchmark a new task
          </Link>
          .
        </p>
      </PageHeader>

      <ProviderProfiles />
      <OndemandCard />
      {user?.is_admin && <CategoryReviewCard />}
      {user?.is_admin && <UserLimitsCard />}
      <BringYourOwnHarnessComingSoon />
    </div>
  )
}

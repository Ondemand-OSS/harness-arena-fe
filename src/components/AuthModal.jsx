import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../auth.jsx'
import { api } from '../api.js'
import { IconEye, IconEyeOff } from './icons.jsx'

const FIELD = 'w-full rounded border border-line-strong bg-floating px-3 py-2 text-sm'

/** Sign-in-or-sign-up dialog. Anyone can create an account; it's not
 *  gatekeeping who can join, just making judging and submitting
 *  attributable to a person once they do. */
export default function AuthModal({ reason, onClose, onSuccess }) {
  const { login, verifySignup } = useAuth()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationSent, setVerificationSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      let user
      if (mode === 'login') {
        user = await login(username, password)
      } else if (verificationSent) {
        user = await verifySignup(email, verificationCode)
      } else {
        await api.requestSignupVerification(username, email, password, displayName)
        setVerificationSent(true)
        setBusy(false)
        return
      }
      onSuccess?.(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4">
      {/* `fixed`, not `absolute`: this button's containing block would
          otherwise be sized to one viewport-height (the outer `fixed`
          wrapper's own box), not the full scrollable content — so once a
          tall dialog pushed this wrapper's `overflow-y-auto` into scrolling,
          scrolling past that one viewport left the backdrop behind and the
          real page showed through next to the dialog's lower content. */}
      <button type="button" className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" className="card w-full max-w-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">{mode === 'login' ? 'Sign in' : 'Create an account'}</p>
              <h2 id="auth-modal-title" className="font-display mt-1 text-2xl font-semibold">
                {mode === 'login' ? 'Welcome back' : 'Join the arena'}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 -mt-2 grid h-9 w-9 shrink-0 place-items-center rounded text-xl leading-none text-ink-2 hover:bg-elevated hover:text-ink"
              aria-label="Close sign-in dialog"
            >
              ×
            </button>
          </div>
        {reason && <p className="mt-2 text-sm text-ink-2">{reason}</p>}

        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            className={FIELD}
            placeholder="Username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={mode === 'signup' && verificationSent}
            required
          />
          {mode === 'signup' && (
            <>
              <input type="email" className={FIELD} placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} disabled={verificationSent} required />
              {!verificationSent && <input className={FIELD} placeholder="Display name (optional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
            </>
          )}
          {!verificationSent && (
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className={`${FIELD} pr-10`}
                placeholder={mode === 'signup' ? 'Password (min 8 characters)' : 'Password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-3 hover:text-ink"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          )}
          {mode === 'signup' && verificationSent && (
            <>
              <p className="text-sm text-ink-2">We sent a six-digit code to {email}. It expires in 15 minutes.</p>
              <input inputMode="numeric" autoComplete="one-time-code" className={FIELD} placeholder="6-digit verification code" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus />
            </>
          )}
          <button type="submit" className="btn-cta w-full text-sm" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : verificationSent ? 'Verify and create account' : 'Send verification code'}
          </button>
          {error && <p className="text-sm text-bad">{error}</p>}
        </form>

        <button
          type="button"
          className="mt-4 text-sm text-link"
          onClick={() => {
            setMode((m) => (m === 'login' ? 'signup' : 'login'))
            setError('')
            setVerificationSent(false)
            setVerificationCode('')
            setShowPassword(false)
          }}
        >
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

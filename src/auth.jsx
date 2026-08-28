import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, setRefreshToken, setUserToken } from './api.js'
import AuthModal from './components/AuthModal.jsx'

const AuthContext = createContext(null)
const SESSION_EXPIRED_REASON = 'Your session expired. Please sign in again.'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [adminMode, setAdminMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sessionExpiredPrompt, setSessionExpiredPrompt] = useState(false)

  const clearUser = useCallback(() => {
    setUserToken(null)
    setUser(null)
    setAdminMode(false)
  }, [])

  useEffect(() => {
    function onSessionExpired() {
      clearUser()
      setSessionExpiredPrompt(true)
    }
    window.addEventListener('arena:session-expired', onSessionExpired)
    return () => window.removeEventListener('arena:session-expired', onSessionExpired)
  }, [clearUser])

  useEffect(() => {
    api
      .refreshSession()
      .then((session) => {
        setUser(session.user)
        setAdminMode(Boolean(session.user.is_admin))
      })
      .catch(clearUser)
      .finally(() => setLoading(false))
  }, [clearUser])

  async function login(username, password) {
    const res = await api.userLogin(username, password)
    setUserToken(res.access_token)
    setRefreshToken(res.refresh_token)
    setUser(res.user)
    setAdminMode(Boolean(res.user.is_admin))
    return res.user
  }

  async function verifySignup(email, code) {
    const res = await api.verifySignup(email, code)
    setUserToken(res.access_token)
    setRefreshToken(res.refresh_token)
    setUser(res.user)
    setAdminMode(Boolean(res.user.is_admin))
    return res.user
  }

  async function logout() {
    setUserToken(null)
    setUser(null)
    setAdminMode(false)
    await api.logoutSession().catch(() => {})
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        loading,
        login,
        verifySignup,
        logout,
        isAdminMode: Boolean(user?.is_admin && adminMode),
        setAdminMode,
      }}
    >
      {children}
      {sessionExpiredPrompt && (
        <AuthModal
          reason={SESSION_EXPIRED_REASON}
          onClose={() => setSessionExpiredPrompt(false)}
          onSuccess={() => setSessionExpiredPrompt(false)}
        />
      )}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>')
  return ctx
}

import { createContext, useContext, useEffect, useState } from 'react'
import { api, setRefreshToken, setUserToken } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [adminMode, setAdminMode] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .refreshSession()
      .then((session) => {
        setUser(session.user)
        setAdminMode(Boolean(session.user.is_admin))
      })
      .catch(() => {
        setUserToken(null)
        setUser(null)
        setAdminMode(false)
      })
      .finally(() => setLoading(false))
  }, [])

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
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>')
  return ctx
}

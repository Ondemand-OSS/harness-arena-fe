import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api.js'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Seo from './components/Seo.jsx'
import Sidebar from './components/Sidebar.jsx'
import SocialDock from './components/SocialDock.jsx'
import TopBar from './components/TopBar.jsx'
import Evaluate from './pages/Evaluate.jsx'
import Benchmark from './pages/Benchmark.jsx'
import Eval from './pages/Eval.jsx'
import BattleLog from './pages/BattleLog.jsx'
import HarnessRoster from './pages/HarnessRoster.jsx'
import HarnessProfile from './pages/HarnessProfile.jsx'
import Leaderboard from './pages/Leaderboard.jsx'
import Methodology from './pages/Methodology.jsx'
import Setup from './pages/Setup.jsx'
import AdminRuns from './pages/AdminRuns.jsx'

function RateLimitToast({ message, onClose }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [onClose, message])

  return (
    <div role="alert" className="fixed bottom-5 left-1/2 z-[110] flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-warn/30 bg-floating px-4 py-3 text-sm font-medium text-warn shadow-xl">
      <span aria-hidden="true">⏳</span>
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" className="text-ink-3 hover:text-ink" aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  )
}

export default function App() {
  // The coarse task group selected in the top bar (Research / Analysis &
  // Risk / …). Lives here because the top bar sets it and the Evaluate page
  // consumes it.
  const [group, setGroup] = useState('')
  const [groups, setGroups] = useState([])
  const [navOpen, setNavOpen] = useState(false)
  const [rateLimitMessage, setRateLimitMessage] = useState('')
  const location = useLocation()

  useEffect(() => {
    api.listGroups().then(setGroups).catch(() => setGroups([]))
  }, [])

  useEffect(() => {
    const showRateLimit = (event) => setRateLimitMessage(event.detail)
    window.addEventListener('arena:rate-limit', showRateLimit)
    return () => window.removeEventListener('arena:rate-limit', showRateLimit)
  }, [])

  return (
    <div className="min-h-screen bg-bg font-body text-ink">
      <Seo pathname={location.pathname} />
      {rateLimitMessage && <RateLimitToast message={rateLimitMessage} onClose={() => setRateLimitMessage('')} />}
      {/* The persistent sidebar (and its own social row) only mounts at
       *  lg+; below that it only exists inside the slide-over nav, so
       *  smaller screens need their own visible copy. */}
      <SocialDock className="fixed bottom-4 left-4 z-40 lg:hidden" />
      {/* Persistent sidebar on large screens; a slide-over on small ones. */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
        <Sidebar />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation menu"
          />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar onNavigate={() => setNavOpen(false)} onClose={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <TopBar
          groups={groups}
          activeGroup={group}
          onGroupChange={setGroup}
          onOpenNav={() => setNavOpen(true)}
        />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {/* Isolates a crash to the routed page itself — the sidebar/top
           *  bar (and React's own tree) stay alive and clickable, unlike an
           *  unhandled error with no boundary anywhere, which unmounts the
           *  whole app to a blank page that only a real reload recovers
           *  from. Re-keyed by path so navigating to a different route
           *  always mounts a fresh attempt instead of re-showing the same
           *  crash. */}
          <ErrorBoundary key={location.pathname}>
            <Routes>
              <Route path="/" element={<Navigate to="/evaluate" replace />} />
              <Route path="/evaluate" element={<Evaluate group={group} onGroupChange={setGroup} />} />
              <Route path="/eval/:taskId" element={<Eval />} />
              <Route path="/benchmark" element={<Benchmark />} />
              <Route path="/battles" element={<BattleLog />} />
              <Route path="/harness" element={<HarnessRoster />} />
              <Route path="/harness/:id" element={<HarnessProfile />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/methodology" element={<Methodology />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/admin/runs" element={<AdminRuns />} />
              <Route path="*" element={<p className="text-ink-2">Page not found.</p>} />
            </Routes>
          </ErrorBoundary>
        </main>
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-ink-3 sm:px-6">
          Harness Arena. The leaderboard is derived from your own judging.
        </footer>
      </div>
    </div>
  )
}

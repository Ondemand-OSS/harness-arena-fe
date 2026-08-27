import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import AuthModal from './AuthModal.jsx'
import { HarnessAvatar } from './ui.jsx'
import {
  IconBattleLog,
  IconEvaluate,
  IconHarness,
  IconLeaderboard,
  IconMethodology,
  IconMoon,
  IconScales,
  IconSetup,
  IconSun,
} from './icons.jsx'

// Label + icon shown in the top-left context pill, per route.
const PAGE_CONTEXT = [
  { match: (p) => p === '/' || p.startsWith('/evaluate'), label: 'Evaluation Engine', Icon: IconScales },
  { match: (p) => p.startsWith('/eval/'), label: 'Evaluation', Icon: IconScales },
  { match: (p) => p.startsWith('/leaderboard'), label: 'Leaderboard', Icon: IconLeaderboard },
  { match: (p) => p.startsWith('/benchmark'), label: 'New Benchmark', Icon: IconScales },
  { match: (p) => p.startsWith('/battles'), label: 'Battle Log', Icon: IconBattleLog },
  { match: (p) => p.startsWith('/harness'), label: 'Harnesses', Icon: IconHarness },
  { match: (p) => p.startsWith('/methodology'), label: 'Methodology', Icon: IconMethodology },
  { match: (p) => p.startsWith('/setup'), label: 'Setup', Icon: IconSetup },
]

// The Research / Analysis & Risk / Operations group nav is a filter on the
// task list, so it's only meaningful  -  and only shown  -  on the page that
// actually has one.
function showGroupNav(pathname) {
  return pathname === '/' || pathname.startsWith('/evaluate')
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('ha-theme', dark ? 'dark' : 'light')
    } catch {
      /* private browsing / storage disabled  -  theme just won't persist */
    }
  }, [dark])

  return (
    <button
      type="button"
      onClick={() => setDark((d) => !d)}
      className="rounded-lg border border-line-strong bg-floating p-2 text-sm text-ink-2 hover:text-ink"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <IconMoon /> : <IconSun />}
    </button>
  )
}

function AdminModeToggle() {
  const { user, isAdminMode, setAdminMode } = useAuth()

  if (!user?.is_admin) return null

  return (
    <button
      type="button"
      onClick={() => setAdminMode((enabled) => !enabled)}
      className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors sm:text-sm ${
        isAdminMode
          ? 'border-warn/50 bg-warn/15 text-warn hover:bg-warn/25'
          : 'border-line-strong bg-floating text-ink-2 hover:bg-elevated hover:text-ink'
      }`}
      aria-pressed={isAdminMode}
      title={isAdminMode ? 'Switch to normal user view' : 'Switch to admin view'}
    >
      {isAdminMode ? 'Admin mode' : 'Normal mode'}
    </button>
  )
}

function UserMenu() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()
  const [showAuth, setShowAuth] = useState(false)
  const [open, setOpen] = useState(false)

  if (loading) return null

  if (!user) {
    return (
      <>
        <button type="button" className="btn-secondary text-sm" onClick={() => setShowAuth(true)}>
          Sign in
        </button>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={() => setShowAuth(false)} />}
      </>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-line-strong bg-floating px-2 py-1.5"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <HarnessAvatar harnessKey={user.avatar_key || user.username} name={user.display_name} size={22} />
        <span className="hidden text-sm font-medium sm:inline">{user.display_name}</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          />
          <div className="card absolute right-0 top-full z-40 mt-2 w-44 p-1.5">
            <p className="truncate px-2 py-1.5 font-mono-arena text-[11px] text-ink-3">@{user.username}</p>
            <button
              type="button"
              onClick={() => {
                logout()
                setOpen(false)
                navigate('/leaderboard')
              }}
              className="w-full rounded px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-elevated hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function TopBar({ groups, activeGroup, onGroupChange, onOpenNav }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const ctx = PAGE_CONTEXT.find((c) => c.match(pathname)) ?? PAGE_CONTEXT[0]
  const { Icon } = ctx

  function pickGroup(group) {
    onGroupChange(group)
    if (!showGroupNav(pathname)) navigate('/evaluate')
  }

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
      <button
        type="button"
        onClick={onOpenNav}
        className="rounded-lg border border-line-strong bg-floating p-2 text-ink-2 lg:hidden"
        aria-label="Open navigation menu"
      >
        <IconBattleLog />
      </button>

      <div className="flex items-center gap-2 rounded-lg bg-elevated px-3 py-1.5 text-sm font-semibold text-ink">
        <Icon />
        <span className="hidden sm:inline">{ctx.label}</span>
      </div>

      {showGroupNav(pathname) && (
        <nav className="mx-auto hidden items-center gap-1 lg:flex" aria-label="Task groups">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => pickGroup(activeGroup === g ? '' : g)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                activeGroup === g ? 'bg-elevated font-semibold text-ink' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {g}
            </button>
          ))}
        </nav>
      )}

      <div className="ml-auto flex items-center gap-2">
        <AdminModeToggle />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}

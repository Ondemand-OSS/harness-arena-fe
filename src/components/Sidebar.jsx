import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import StartJudgingButton from './StartJudgingButton.jsx'
import SocialDock from './SocialDock.jsx'
import {
  IconActivity,
  IconBattleLog,
  IconEvaluate,
  IconHarness,
  IconLeaderboard,
  IconMethodology,
  IconScales,
  IconSetup,
} from './icons.jsx'

const NAV = [
  { to: '/evaluate', label: 'Evaluate', Icon: IconEvaluate },
  { to: '/leaderboard', label: 'Leaderboard', Icon: IconLeaderboard },
  { to: '/benchmark', label: 'New Benchmark', Icon: IconScales },
  { to: '/battles', label: 'Battle Log', Icon: IconBattleLog },
  { to: '/harness', label: 'Harnesses', Icon: IconHarness },
  { to: '/methodology', label: 'Methodology', Icon: IconMethodology },
  { to: '/setup', label: 'Setup', Icon: IconSetup },
]

export default function Sidebar({ onNavigate, onClose }) {
  const { isAdminMode } = useAuth()
  return (
    <div className="flex h-full flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-5 py-5">
        <Link to="/" onClick={onNavigate} className="flex min-w-0 items-center gap-2" aria-label="Harness Arena home">
          <span aria-hidden="true">⚔️</span>
          <span className="truncate font-display text-lg font-semibold text-ink">Harness Arena</span>
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded text-xl leading-none text-ink-2 hover:bg-elevated hover:text-ink"
            aria-label="Close navigation menu"
          >
            ×
          </button>
        )}
      </div>

      <nav className="flex flex-col gap-1 px-3" aria-label="Main navigation">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
          >
            <Icon className="shrink-0 text-base" />
            <span className="text-sm">{label}</span>
          </NavLink>
        ))}
        {isAdminMode && (
          <NavLink
            to="/admin/runs"
            onClick={onNavigate}
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
          >
            <IconActivity className="shrink-0 text-base" />
            <span className="text-sm">Runs</span>
          </NavLink>
        )}
      </nav>

      <div className="mt-auto px-4 pb-4 pt-6">
        <SocialDock className="mb-3" />
        <StartJudgingButton className="btn-cta w-full text-center text-sm" onNavigate={onNavigate} />
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
          <Link to="/methodology" onClick={onNavigate} className="hover:text-ink-2">
            Methodology
          </Link>
          <Link to="/battles" onClick={onNavigate} className="hover:text-ink-2">
            Battle Log
          </Link>
          <Link to="/setup" onClick={onNavigate} className="hover:text-ink-2">
            Setup
          </Link>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { EmptyState, HarnessAvatar, PageHeader, Tag, identityColor } from '../components/ui.jsx'

export default function HarnessRoster() {
  const [harnesses, setHarnesses] = useState([])
  const [board, setBoard] = useState({})

  useEffect(() => {
    api.listHarnesses().then(setHarnesses).catch(() => {})
    api
      .leaderboard()
      .then((rows) => setBoard(Object.fromEntries(rows.map((r) => [r.harness_key, r]))))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="The roster" title="Harnesses">
        <p>
          Every harness competing in the arena. All of them run the same task under the same model, so what is being
          measured is the harness itself, not the model behind it.
        </p>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        {harnesses.map((h) => {
          const stats = board[h.key]
          return (
            <div key={h.key} className="card card-hover border-l-4 p-5" style={{ borderLeftColor: identityColor(h.key) }}>
              <div className="flex items-start gap-3">
                <HarnessAvatar harnessKey={h.key} name={h.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg font-semibold">{h.name}</h2>
                    {!h.enabled && <Tag tone="gold">coming soon</Tag>}
                    {h.is_custom && <Tag>custom</Tag>}
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{h.tagline || 'N/A'}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                {stats ? (
                  <p className="font-mono-arena text-xs text-ink-2">
                    Elo {Math.round(stats.elo)} · {stats.battles} battle{stats.battles === 1 ? '' : 's'} ·{' '}
                    {(stats.win_rate * 100).toFixed(0)}% win rate
                  </p>
                ) : (
                  <p className="text-xs text-ink-3">No ranked battles yet</p>
                )}
                <Link to={`/harness/${h.key}`} className="text-sm text-link">
                  Profile →
                </Link>
              </div>
            </div>
          )
        })}
        {harnesses.length === 0 && <EmptyState>No harnesses registered.</EmptyState>}
      </div>
    </div>
  )
}

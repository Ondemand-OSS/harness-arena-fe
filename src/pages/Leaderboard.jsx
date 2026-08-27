import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import {
  EmptyState,
  FilterPills,
  HarnessAvatar,
  IdentityStrip,
  LoadingState,
  RateBar,
  Sparkline,
  StatsGrid,
  identityColor,
} from '../components/ui.jsx'

/** Rank badge: a solid pill for the podium ranks (1st–3rd), a plain
 *  numeral past that  -  matches the reference leaderboard's table, where
 *  only the ranks that also got a podium card are set off with a chip. */
function RankBadge({ rank }) {
  if (rank > 3) return <span className="font-mono-arena text-xs text-ink-2">{rank}</span>
  const tone = { 1: 'rank-gold', 2: 'rank-silver', 3: 'rank-bronze' }[rank]
  return (
    <span className={`rank-badge ${tone}`}>
      {ORDINAL[rank]}
    </span>
  )
}

const PODIUM_BG = {
  1: 'var(--podium-gold)',
  2: 'var(--podium-silver)',
  3: 'var(--podium-bronze)',
}
const PODIUM_COLOR = {
  1: 'var(--rank-gold-bg)',
  2: 'var(--rank-silver-bg)',
  3: 'var(--rank-bronze-bg)',
}
const PODIUM_TONE = { 1: 'rank-gold', 2: 'rank-silver', 3: 'rank-bronze' }
const ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd' }
// Same gold/silver/bronze wash as the podium cards above the table, applied
// to the table row itself — so a row's rank still reads at a glance further
// down the list, past where the podium's own gold/silver/bronze cards end.
const ROW_TONE = { 1: 'leaderboard-row-gold', 2: 'leaderboard-row-silver', 3: 'leaderboard-row-bronze' }

/** Rating change since this harness's previous judged task  -  real
 *  movement read off the same `history` the trend sparkline plots, not a
 *  separate synthesized number. Null (rendered as "–") until there are at
 *  least two points to diff. */
function lastDelta(history) {
  if (!history || history.length < 2) return null
  return Math.round(history[history.length - 1] - history[history.length - 2])
}

function Movement({ change }) {
  const d = change
  if (d == null || d === 0) return <span className="font-mono-arena text-xs text-ink-3">N/A</span>
  const up = d > 0
  return (
    <span className={`font-mono-arena text-xs ${up ? 'text-good' : 'text-bad'}`}>
      {up ? '▲' : '▼'} {up ? '+' : ''}
      {d}
    </span>
  )
}

function EloChange({ history }) {
  const delta = lastDelta(history)
  if (delta == null || delta === 0) return null
  return (
    <span className={`font-mono-arena text-[10px] ${delta > 0 ? 'text-good' : 'text-bad'}`}>
      {delta > 0 ? '+' : ''}{delta}
    </span>
  )
}

function formatDuration(seconds) {
  if (seconds == null) return 'N/A'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  return minutes ? `${minutes}m ${String(remainder).padStart(2, '0')}s` : `${remainder}s`
}

function PodiumCard({ rank, row, harness, featured }) {
  const d = lastDelta(row.history)
  return (
    <div
      className={`card card-hover relative overflow-hidden p-5 text-center ${featured ? 'sm:-mt-3 sm:pb-8 sm:pt-7' : ''}`}
      style={{ backgroundImage: PODIUM_BG[rank], backgroundColor: PODIUM_COLOR[rank], borderColor: 'transparent' }}
    >
      <span className={`rank-badge absolute right-3 top-3 font-mono-arena text-[10px] uppercase tracking-wider ${PODIUM_TONE[rank]}`}>
        {ORDINAL[rank]}
      </span>
      <div className="flex justify-center">
        <HarnessAvatar harnessKey={row.harness_key} name={harness?.name} size={featured ? 44 : 36} />
      </div>
      <p className="font-display mt-3 text-lg font-semibold">{harness?.name ?? row.harness_key}</p>
      {rank === 1 && (
        <span className="mt-2 inline-flex rounded-full bg-good/20 px-2 py-0.5 font-mono-arena text-[10px] font-semibold text-good">
          🏆 Winner
        </span>
      )}
      <p className="text-xs text-ink-3">{harness?.is_custom ? 'custom harness' : 'built-in'}</p>
      <p className={`font-display mt-2 flex items-center justify-center gap-2 font-semibold ${featured ? 'text-4xl' : 'text-3xl'}`}>
        {Math.round(row.elo)}
        {d != null && d !== 0 && (
          <span className={`font-mono-arena text-xs font-normal ${d > 0 ? 'text-good' : 'text-bad'}`}>
            {d > 0 ? '+' : ''}
            {d}
          </span>
        )}
      </p>
      <div className="mt-2 flex justify-center">
        <Sparkline values={row.history} />
      </div>
      <p className="mt-2 text-xs text-ink-2">
        {(row.win_rate * 100).toFixed(0)}% win rate · {row.battles} battle{row.battles === 1 ? '' : 's'}
      </p>
      <p className="mt-1 font-mono-arena text-[11px] text-ink-3">
        {row.judge_mean != null ? (
          <>Artificial Analysis AI judge {row.judge_mean.toFixed(1)}/10 · {row.judge_graded} graded tasks</>
        ) : (
          'Artificial Analysis AI judge coming soon'
        )}
      </p>
    </div>
  )
}

export default function Leaderboard() {
  const [rows, setRows] = useState([])
  const [harnesses, setHarnesses] = useState({})
  const [groups, setGroups] = useState([])
  const [group, setGroup] = useState('')
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listGroups().then(setGroups).catch(() => {})
    api.stats().then(setStats).catch(() => {})
    api
      .listHarnesses()
      .then((list) => setHarnesses(Object.fromEntries(list.map((h) => [h.key, h]))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    api
      .leaderboard(group || undefined)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [group])

  // Podium renders 2nd / 1st / 3rd so the winner sits centered and raised.
  const podium = rows.slice(0, 3)
  const podiumOrder = [podium[1], podium[0], podium[2]]
    .map((row, i) => (row ? { row, rank: [2, 1, 3][i] } : null))
    .filter(Boolean)

  // "Ranked battles" is the number of pairwise comparisons actually
  // resolved, system-wide  -  each one is counted once per side in `battles`,
  // so halve the sum rather than re-deriving it separately from scores.
  const rankedBattles = Math.round(rows.reduce((sum, r) => sum + r.battles, 0) / 2)

  return (
    <div className="space-y-6">
      {/* Heading and filters are deliberately separate blocks rather than a
          header-with-aside: a wide pill row competing with the heading in one
          flex row is what previously collapsed the text to one word per line. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Global rankings</p>
          <h1 className="font-display mt-1 text-3xl font-semibold leading-tight sm:text-4xl">Leaderboard</h1>
          <p className="mt-2 max-w-2xl text-ink-2">
            Elo{group ? ` for ${group}` : ''}. Updated continuously from submitted judgements.
          </p>
        </div>
        <FilterPills options={groups} value={group} onChange={setGroup} allLabel="All groups" />
      </div>

      {stats && (
        <StatsGrid
          items={[
            { label: 'Ranked battles', value: rankedBattles },
            { label: 'Harnesses ranked', value: rows.length },
            { label: 'Tasks in pool', value: stats.tasks },
            { label: 'Votes cast', value: rows.reduce((sum, row) => sum + (row.votes ?? 0), 0) },
          ]}
        />
      )}

      {loading ? (
        <LoadingState label="Loading leaderboard…" />
      ) : rows.length === 0 ? (
        <EmptyState>
          No ranked battles logged yet. Judge a task in{' '}
          <Link to="/evaluate" className="text-link">
            Evaluate
          </Link>{' '}
          to put harnesses on the board.
        </EmptyState>
      ) : (
        <>
          <div className="grid items-end gap-3 sm:grid-cols-3">
            {podiumOrder.map(({ row, rank }) => (
              <PodiumCard
                key={row.harness_key}
                rank={rank}
                row={row}
                harness={harnesses[row.harness_key]}
                featured={rank === 1}
              />
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-elevated text-left">
                  <tr className="text-ink-3">
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Rank</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Move</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Harness</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Score ↓</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Trend</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Win rate</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Artificial Analysis AI judge</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Votes</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">W / L / T</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Battles</th>
                    <th className="px-4 py-2 font-mono-arena text-[10px] uppercase tracking-wider">Median time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const h = harnesses[row.harness_key]
                    return (
                      <tr
                        key={row.harness_key}
                        className={`border-t border-line transition-colors hover:bg-floating/80 ${ROW_TONE[i + 1] ?? ''}`}
                      >
                        <td className="px-4 py-3">
                          <RankBadge rank={i + 1} />
                        </td>
                        <td className="px-4 py-3">
                          <Movement change={row.rank_movement} />
                        </td>
                        <td className="px-4 py-3">
                          <Link to={`/harness/${row.harness_key}`} className="flex items-center gap-2">
                            <IdentityStrip harnessKey={row.harness_key} className="h-6" />
                            <HarnessAvatar harnessKey={row.harness_key} name={h?.name} size={24} />
                            <span className="min-w-0">
                              <span className="block font-semibold text-ink hover:text-link">
                                {h?.name ?? row.harness_key}
                                {i === 0 && <span className="ml-2 font-mono-arena text-[10px] text-good">🏆 Winner</span>}
                              </span>
                              <span className="block text-[11px] text-ink-3">
                                {h?.is_custom ? 'custom · webhook' : 'built-in'}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 font-mono-arena">
                            {Math.round(row.elo)}
                            <EloChange history={row.history} />
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Sparkline values={row.history} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <RateBar value={row.win_rate} color={identityColor(row.harness_key)} />
                            <span className="font-mono-arena text-xs">{(row.win_rate * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-arena text-xs">
                          {row.judge_mean != null ? (
                            <>
                              {row.judge_mean.toFixed(1)}
                              <span className="text-ink-3">/10 · {row.judge_graded} graded tasks</span>
                            </>
                          ) : (
                            <span className="text-ink-3" title="Artificial Analysis AI judge coming soon">
                              Coming soon
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono-arena text-xs">{row.votes ?? 0}</td>
                        <td className="px-4 py-3 font-mono-arena text-xs">
                          {row.wins} / {row.losses} / {row.ties}
                        </td>
                        <td className="px-4 py-3 font-mono-arena text-xs">{row.battles}</td>
                        <td className="px-4 py-3 font-mono-arena text-xs text-ink-2">{formatDuration(row.median_time_seconds)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-ink-3">
            Ratings start at 1000 and move by up to 32 points of total exchange per task. With only a handful of judged
            tasks, treat the order as provisional. A single re-score can reorder it. Trend and movement plot each
            harness's own rating history, point-for-point. Nothing here is smoothed or synthesized.
          </p>
        </>
      )}
    </div>
  )
}

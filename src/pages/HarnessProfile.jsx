import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { EmptyState, HarnessAvatar, LoadingState, PageHeader, StatsGrid } from '../components/ui.jsx'

export default function HarnessProfile() {
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [battles, setBattles] = useState([])
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setNotFound(false)
    setProfile(null)
    api.harnessProfile(id).then(setProfile).catch(() => setNotFound(true))
  }, [id])

  // Recent judged tasks this harness took part in, newest first.
  useEffect(() => {
    let cancelled = false
    api
      .listTasks()
      .then((tasks) =>
        Promise.all(
          tasks.map(async (task) => {
            const cmp = await api.compare(task.id_aa)
            if (!cmp.revealed) return null
            const mine = cmp.entries.find((e) => e.harness_key === id)
            if (!mine || mine.already_scored == null) return null
            const best = Math.max(...cmp.entries.map((e) => e.already_scored ?? 0))
            const topCount = cmp.entries.filter((e) => e.already_scored === best).length
            return {
              task,
              score: mine.already_scored,
              result: mine.already_scored === best ? (topCount > 1 ? 'Tie' : 'Win') : 'Loss',
            }
          })
        )
      )
      .then((rows) => {
        if (!cancelled) setBattles(rows.filter(Boolean))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id])

  if (notFound) {
    return (
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-semibold">Harness not found</h1>
        <p className="text-ink-2">No harness answers to that id in the current roster.</p>
        <Link to="/harness" className="btn-secondary inline-block text-sm">
          Back to the roster
        </Link>
      </div>
    )
  }

  if (!profile) return <LoadingState label="Loading harness profile…" />

  const s = profile.stats
  const RESULT_TONE = { Win: 'text-good', Loss: 'text-bad', Tie: 'text-ink-2' }

  return (
    <div className="space-y-6">
      <Link to="/harness" className="text-sm text-link">
        ← Back to the roster
      </Link>

      <PageHeader
        eyebrow="Fighter profile"
        title={
          <span className="flex items-center gap-3">
            <HarnessAvatar harnessKey={profile.key} name={profile.name} size={40} />
            {profile.name}
          </span>
        }
      >
        <p>{profile.tagline || 'N/A'}</p>
      </PageHeader>

      <div>
        <p className="eyebrow mb-2">Live. From your own judging</p>
        {s ? (
          <StatsGrid
            items={[
              { label: 'Elo', value: Math.round(s.elo) },
              { label: 'Battles', value: s.battles },
              { label: 'Win rate', value: `${(s.win_rate * 100).toFixed(0)}%` },
              { label: 'W / L / T', value: `${s.wins}/${s.losses}/${s.ties}` },
            ]}
          />
        ) : (
          <EmptyState>No ranked battles logged for this harness yet.</EmptyState>
        )}
      </div>

      <div>
        <p className="eyebrow mb-2">Artificial Analysis AI judge</p>
        {profile.judge?.mean_score != null ? (
        <div>
          <StatsGrid
            items={[
              { label: 'Mean score', value: `${profile.judge.mean_score.toFixed(1)}/10` },
              { label: 'As percent', value: `${profile.judge.mean_score_pct}%` },
              { label: 'Tasks graded', value: profile.judge.graded },
              { label: 'Not graded', value: profile.judge.ungraded },
            ]}
          />
          <p className="mt-2 text-xs text-ink-3">
            Computed from this harness's stored judge verdicts. Tasks the judge declined to score are excluded from
            the mean rather than counted as zero. {profile.judge.graded} of {profile.judge.total} contributed.
          </p>
        </div>
        ) : (
          <p className="rounded-lg border border-line bg-floating p-4 text-sm text-ink-3">
            Artificial Analysis AI judge coming soon
          </p>
        )}
      </div>

      {profile.judge_by_category?.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Judge score by category</p>
          <div className="card divide-y divide-line">
            {profile.judge_by_category.map((c) => (
              <div key={c.category} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{c.category}</p>
                  <p className="font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">{c.group}</p>
                </div>
                <div className="shrink-0 text-right">
                  {c.mean_score != null ? (
                    <>
                      <p className="font-mono-arena text-sm">{c.mean_score.toFixed(1)}/10</p>
                      <p className="font-mono-arena text-[10px] text-ink-3">
                        {c.graded} of {c.total} graded
                      </p>
                    </>
                  ) : (
                    <p className="font-mono-arena text-xs text-ink-3">not graded</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {battles.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Recent battles</p>
          <div className="space-y-2">
            {battles.map((b) => (
              <Link
                key={b.task.id_aa}
                to={`/eval/${b.task.id_aa}`}
                className="card flex items-center justify-between gap-3 p-3 transition-colors hover:bg-elevated"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{b.task.title}</p>
                  <p className="font-mono-arena text-[11px] text-ink-3">{b.task.category}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm font-semibold ${RESULT_TONE[b.result]}`}>{b.result}</p>
                  <p className="font-mono-arena text-[11px] text-ink-3">{b.score}/10</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

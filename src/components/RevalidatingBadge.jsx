/** Small, subtle indicator for "showing cached content while a background
 *  refresh is in flight"  -  the stale-while-revalidate pages (BattleLog,
 *  Evaluate, Benchmark; see lib/pageCache.js) render instantly from
 *  whatever was cached, then silently refetch and correct anything that's
 *  changed since. Without this, a value that visibly changes a moment
 *  after the page loads (a status, a "run by" attribution, a count) reads
 *  as a bug  -  this gives it a reason to look like one: "this is still
 *  settling," not "this is wrong." Renders nothing once the refresh
 *  completes. */
export default function RevalidatingBadge({ show }) {
  if (!show) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-mono-arena text-[10px] uppercase tracking-wider text-ink-3">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-link" aria-hidden="true" />
      Updating…
    </span>
  )
}

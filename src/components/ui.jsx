// Shared presentational primitives for the arena's pages: page headers with
// uppercase eyebrows, filter pill rows, stat strips, tags/chips, collapsible
// sections, sparklines, and harness avatars.
import { useState } from 'react'
import { BRAND_MARKS, markForModel } from './brandLogos.jsx'
import { IconChevron } from './icons.jsx'

export function PageHeader({ eyebrow, title, children, aside }) {
  // The text column needs `flex-1` alongside `min-w-0`: with only min-w-0 it
  // shrinks to its minimum content width while a wide `aside` (e.g. a row of
  // filter pills) takes all remaining space, which collapsed the heading and
  // body to one word per line. Stacking is kept until `lg` because an aside
  // wide enough to matter doesn't fit beside text at tablet widths.
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="font-display mt-1 text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
        {children && <div className="mt-3 max-w-2xl text-ink-2">{children}</div>}
      </div>
      {aside && <div className="lg:shrink-0">{aside}</div>}
    </div>
  )
}

export function Pill({ active, children, ...rest }) {
  return (
    <button type="button" className={`pill ${active ? 'pill-active' : ''}`} {...rest}>
      {children}
    </button>
  )
}

/** A row of filter pills with a leading "All" option.
 *  `value === ''` means "All". */
export function FilterPills({ options, value, onChange, allLabel = 'All' }) {
  if (!options.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill active={value === ''} onClick={() => onChange('')}>
        {allLabel}
      </Pill>
      {options.map((opt) => (
        <Pill key={opt} active={value === opt} onClick={() => onChange(opt)}>
          {opt}
        </Pill>
      ))}
    </div>
  )
}

/** Bordered strip of "big number + label" cells, as on the leaderboard. */
export function StatsGrid({ items }) {
  return (
    <div className="card grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
      {items.map((it) => (
        <div key={it.label} className="px-4 py-3">
          <p className="eyebrow">{it.label}</p>
          <p className="font-display mt-1 text-2xl font-semibold">{it.value}</p>
        </div>
      ))}
    </div>
  )
}

/** Inline "11 tasks · 3 harnesses · 33 recorded runs" summary line. */
export function StatsLine({ items }) {
  return (
    <div className="card flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm text-ink-2">
      {items.map((it, i) => (
        <span key={it.label} className="flex items-center gap-2">
          {i > 0 && <span className="text-ink-3">·</span>}
          <span className="font-mono-arena font-semibold text-ink">{it.value}</span>
          <span>{it.label}</span>
          {it.badge && <span className="relative top-px inline-flex items-center rounded-sm border border-cta/30 bg-cta/10 px-2 py-1 font-mono-arena text-[10px] font-semibold uppercase tracking-wider leading-none text-cta">{it.badge}</span>}
        </span>
      ))}
    </div>
  )
}

export function Tag({ children, tone }) {
  const toneStyle =
    tone === 'gold'
      ? { background: 'var(--tint-gold)', color: 'var(--gold)' }
      : undefined
  return (
    <span className="tag" style={toneStyle}>
      {children}
    </span>
  )
}

export function FileTypeChips({ types }) {
  if (!types?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((t) => (
        <Tag key={t}>{t}</Tag>
      ))}
    </div>
  )
}

/** Info banner with a leading glyph  -  "Outputs are anonymized…". */
export function Notice({ icon = '⚖', children }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line-strong bg-floating px-3 py-2 text-sm text-ink-2">
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

export function Collapsible({ label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-3 text-left text-sm font-semibold text-ink"
        aria-expanded={open}
      >
        <IconChevron
          className={`shrink-0 text-xs text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        {label}
      </button>
      {open && <div className="pb-4 text-sm text-ink-2">{children}</div>}
    </div>
  )
}

/** Tiny inline trend sparkline. `values` are plotted in order. */
export function Sparkline({ values, width = 68, height = 22 }) {
  if (!values || values.length < 2) {
    return <span className="text-xs text-ink-3">N/A</span>
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2])
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lastX, lastY] = points[points.length - 1]

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <path d={path} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="var(--side-a)" />
    </svg>
  )
}

/** Horizontal proportion bar used for win rate / deliverable counts.
 *  `color` defaults to the arena's neutral accent, but every call site that
 *  represents one specific harness should pass its identityColor() so the
 *  bar reads as "that harness's" bar at a glance, same as its strip. */
export function RateBar({ value, color = 'var(--side-a)' }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100
  return (
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-elevated">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

// Stable per-harness accent + initials, so a harness looks the same
// everywhere it appears (roster, leaderboard, reveal cards).
// Real brand-icon background colors (not the arena's own --side-* tokens):
// Anthropic's terracotta tile, and the near-black tile both OpenAI and
// OnDemand's own marks are drawn for  -  matches the source art in
// src/images/ rather than an arbitrary arena accent. Hermes and OpenClaw
// don't have an official tile color on record (no app-icon source was
// supplied, just a wordmark and a mascot on their own transparent/checker
// background), so these two are a picked-not-sourced dark neutral  -  dark
// so hermesMark's white wordmark stays legible and openclawMark's red
// mascot doesn't clash with a same-hue tile.
const HARNESS_ACCENT = {
  'claude-code': '#d97757',
  codex: '#181818',
  ondemand: '#111111',
  hermes: '#141416',
  openclaw: '#241c1d',
  opencode: '#15181c',
}

function accentFor(key) {
  if (HARNESS_ACCENT[key]) return HARNESS_ACCENT[key]
  // Deterministic fallback for custom (bring-your-own) harnesses.
  const hash = [...(key || '')].reduce((a, c) => a + c.charCodeAt(0), 0)
  return [`var(--side-a)`, `var(--side-b)`, `var(--side-c)`, `var(--gold)`][hash % 4]
}

// A separate palette from HARNESS_ACCENT above: that one matches each
// vendor's real icon-tile color (which is near-black for both OpenAI and
// OnDemand, so it can't tell them apart at a glance). This one exists
// purely so every harness gets its own unique, always-distinguishable
// color for "which side is which" strips/legends  -  fixed for the builtins,
// hashed for custom harnesses.
const IDENTITY_COLORS = ['var(--side-a)', 'var(--side-b)', 'var(--side-c)', 'var(--gold)', 'var(--good)', 'var(--bad)']
const HARNESS_IDENTITY = {
  'claude-code': 'var(--side-b)',
  codex: 'var(--side-c)',
  ondemand: 'var(--side-a)',
  hermes: 'var(--gold)',
  openclaw: 'var(--good)',
  opencode: 'var(--bad)',
}

export function identityColor(key) {
  if (HARNESS_IDENTITY[key]) return HARNESS_IDENTITY[key]
  const hash = [...(key || '')].reduce((a, c) => a + c.charCodeAt(0), 0)
  return IDENTITY_COLORS[hash % IDENTITY_COLORS.length]
}

/** Small colored strip marking which harness a row belongs to  -  the same
 *  color every time that harness appears, so a long list (Battle Log) can
 *  be scanned by color the way the reference UI does.
 *
 *  `self-center`, not `self-stretch`: every call site passes an explicit
 *  fixed height (h-4/h-5/h-6, sized to roughly match the avatar next to
 *  it)  -  combined with `self-stretch`, a fixed height can't actually be
 *  stretched, so per the flexbox spec it degenerates to `flex-start`
 *  instead (pinned to the top of the row) rather than being centered like
 *  every sibling that inherits the parent's own `items-center`. On a
 *  multi-line row (e.g. Leaderboard's name + subtitle) that reads as the
 *  color strip sitting up near the top while the avatar/logo next to it
 *  sits centered lower  -  exactly the "color's above, the logo's below"
 *  mismatch this fixes. */
export function IdentityStrip({ harnessKey, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-1 shrink-0 self-center rounded-sm ${className}`}
      style={{ background: identityColor(harnessKey) }}
    />
  )
}

export function HarnessAvatar({ harnessKey, name, size = 28 }) {
  const Mark = BRAND_MARKS[harnessKey]
  const initials = (name || harnessKey || '?')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-mono-arena font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: accentFor(harnessKey),
        color: '#fff',
      }}
      aria-hidden="true"
    >
      {Mark ? <Mark style={{ width: size * 0.62, height: size * 0.62 }} /> : initials}
    </span>
  )
}

/** Small "which model produced this" tag  -  a badge for plain text, or the
 *  vendor's logo alongside the model id when one is recognized (see
 *  MODEL_MARKS in brandLogos.jsx; today that's just DeepSeek, since that's
 *  the only model actually run in this arena so far). */
export function ModelBadge({ model, className = '' }) {
  if (!model) return null
  const Mark = markForModel(model)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded bg-elevated px-1.5 py-0.5 font-mono-arena text-[10px] text-ink-2 ${className}`}
      title={`Run with ${model}`}
    >
      {Mark && <Mark style={{ width: 11, height: 11 }} />}
      {model}
    </span>
  )
}

/** A/B/C(/D/E/F) badge for an anonymized output, colored by slot. Six
 *  tokens rather than three: a battle can have more than 3 harnesses
 *  running (the registry isn't capped at 3), and reusing colors past that
 *  would make two different outputs look like the same one. */
const SIDE_TOKENS = ['--side-a', '--side-b', '--side-c', '--side-d', '--side-e', '--side-f']

export function sideToken(index) {
  return SIDE_TOKENS[index % SIDE_TOKENS.length]
}

/** A fresh, unpredictable color-to-slot mapping  -  call once per blind
 *  comparison load (see Eval.jsx) so which color "Output A" gets isn't a
 *  fixed, memorizable fact either, same reasoning as the server re-rolling
 *  which run gets which letter on every request. Not used outside the
 *  blind judging page: Battle Log already shows real identities, so a
 *  stable color-per-slot there isn't revealing anything. */
export function shuffleSideTokens() {
  const tokens = [...SIDE_TOKENS]
  for (let i = tokens.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[tokens[i], tokens[j]] = [tokens[j], tokens[i]]
  }
  return tokens
}

export function SlotBadge({ index, letter, size = 24, token }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded font-mono-arena font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5, background: `var(${token ?? sideToken(index)})` }}
      aria-hidden="true"
    >
      {letter}
    </span>
  )
}

export function EmptyState({ children }) {
  return <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-3">{children}</p>
}

/** Windowed page-number list around `page`: always includes 1 and
 *  `pageCount`, a `null` standing in for an ellipsis gap between
 *  non-adjacent numbers. Keeps a long list (e.g. 40 pages of 6 items)
 *  from spilling dozens of buttons across the row. */
function paginationWindow(page, pageCount) {
  const span = 1
  const nums = new Set([1, pageCount, page])
  for (let d = 1; d <= span; d++) {
    if (page - d >= 1) nums.add(page - d)
    if (page + d <= pageCount) nums.add(page + d)
  }
  const sorted = [...nums].sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(null)
    out.push(sorted[i])
  }
  return out
}

/** Shared page-number control for any list split into fixed-size pages
 *  (Battle Log, Evaluate, …). 1-indexed `page`; renders nothing for a
 *  single page so callers can mount it unconditionally. */
export function Pagination({ page, pageCount, onChange, className = '' }) {
  if (pageCount <= 1) return null
  return (
    <nav className={`flex items-center justify-center gap-1.5 ${className}`} aria-label="Pagination">
      <button
        type="button"
        className="flex h-8 min-w-8 items-center justify-center rounded-full border border-line px-2 text-ink-2 transition-colors hover:border-line-strong hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        <IconChevron className="rotate-90 text-sm" />
      </button>
      {paginationWindow(page, pageCount).map((n, i) =>
        n == null ? (
          <span key={`gap-${i}`} className="px-1 font-mono-arena text-xs text-ink-3">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            aria-current={n === page ? 'page' : undefined}
            className={`flex h-8 min-w-8 items-center justify-center rounded-full border px-2.5 font-mono-arena text-xs transition-colors ${
              n === page
                ? 'border-cta bg-cta/10 font-semibold text-cta'
                : 'border-line text-ink-2 hover:border-line-strong hover:bg-elevated'
            }`}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        )
      )}
      <button
        type="button"
        className="flex h-8 min-w-8 items-center justify-center rounded-full border border-line px-2 text-ink-2 transition-colors hover:border-line-strong hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        <IconChevron className="-rotate-90 text-sm" />
      </button>
    </nav>
  )
}

export function LoadingState({ label = 'Loading…', className = '', compact = false }) {
  return (
    <div
      className={`${compact ? 'flex items-center justify-center gap-3 px-3 py-2 text-sm text-ink-2' : 'card flex min-h-32 items-center justify-center gap-3 px-4 py-8 text-sm text-ink-2'} ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="relative grid h-7 w-7 place-items-center" aria-hidden="true">
        <span className="absolute h-7 w-7 animate-ping rounded-full bg-cta/10" />
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-cta" />
      </span>
      <span>{label}</span>
    </div>
  )
}

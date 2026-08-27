import { useEffect, useMemo, useState } from 'react'

// Paper/plastic strip colors pulled from the app's own accent palette
// (theme.css's --side-*/--gold/--cta tokens) rather than a generic rainbow,
// so a celebration still reads as part of this app's look.
const COLORS = ['--side-a', '--side-b', '--side-c', '--side-d', '--side-e', '--side-f', '--gold', '--cta']

const PIECE_COUNT = 90
// Total time a piece can still be falling/spinning, including its own
// staggered start delay — kept short ("for a very short time") rather than
// a long lingering shower.
const MAX_FALL_MS = 1600
const MAX_DELAY_MS = 300

function makePieces() {
  return Array.from({ length: PIECE_COUNT }, (_, i) => {
    const duration = 1000 + Math.random() * (MAX_FALL_MS - 1000)
    return {
      id: i,
      left: Math.random() * 100, // vw%
      drift: (Math.random() - 0.5) * 220, // px, horizontal sway while falling
      rotate: 360 * (2 + Math.random() * 3) * (Math.random() < 0.5 ? -1 : 1), // deg
      duration,
      delay: Math.random() * MAX_DELAY_MS,
      width: 6 + Math.random() * 6,
      height: 12 + Math.random() * 10,
      color: `var(${COLORS[i % COLORS.length]})`,
    }
  })
}

/** A short burst of falling paper/plastic strips, for the moment identities
 *  and scores are revealed — a beat of celebration, not a persistent effect.
 *  Mount with `active` true; calls `onDone` once every piece has finished
 *  falling so the caller can unmount it (see Eval.jsx's `submit()`, which
 *  only sets this after a REVEAL this viewer's own action just caused, not
 *  on every page load of an already-revealed task). Purely decorative -
 *  `aria-hidden` and `pointer-events-none` throughout. */
export default function Confetti({ active, onDone }) {
  const [pieces] = useState(makePieces)
  const totalMs = useMemo(() => MAX_DELAY_MS + MAX_FALL_MS, [])

  useEffect(() => {
    if (!active) return undefined
    const timer = setTimeout(() => onDone?.(), totalMs)
    return () => clearTimeout(timer)
  }, [active, totalMs, onDone])

  if (!active) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[200] overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.width,
            height: p.height,
            background: p.color,
            animationDuration: `${p.duration}ms`,
            animationDelay: `${p.delay}ms`,
            '--confetti-drift': `${p.drift}px`,
            '--confetti-rotate': `${p.rotate}deg`,
          }}
        />
      ))}
    </div>
  )
}

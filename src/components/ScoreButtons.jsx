import { sideToken } from './ui.jsx'

const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Discrete 1-10 score picker. Discrete buttons (rather than a slider) make
 *  the chosen value unambiguous and keep every option one click away, which
 *  matters when the judge is comparing several outputs side by side. */
export default function ScoreButtons({ value, onChange, disabled, slotIndex = 0 }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Score out of 10">
      {SCALE.map((n) => {
        const active = value === n
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            aria-pressed={active}
            className="score-btn"
            style={
              active
                ? { background: `var(${sideToken(slotIndex)})`, borderColor: `var(${sideToken(slotIndex)})`, color: '#fff' }
                : undefined
            }
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

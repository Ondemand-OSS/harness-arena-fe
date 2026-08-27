import { useEffect, useRef, useState } from 'react'
import { IconChevron } from './icons.jsx'

/** A compact, accessible menu for model choices. Unlike a native select it
 * keeps long provider model ids visible and lets a choice carry a badge. */
export default function ChoiceDropdown({ value, options, onChange, placeholder, disabled = false, compact = false, className = '' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selected = options.find((item) => String(item.id) === String(value))

  useEffect(() => {
    function close(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center gap-3 border border-line-strong bg-surface px-3 text-left text-sm text-ink shadow-sm transition-colors hover:border-ink-3 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? 'h-10 rounded-full' : 'min-h-11 rounded-lg py-2'
        }`}
      >
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="flex flex-wrap items-center gap-1.5 font-medium leading-5">
                <span className={compact ? 'block truncate' : ''}>{selected.label}</span>
                {selected.free && <span className="rounded-full bg-cta/15 px-2 py-0.5 font-mono-arena text-[10px] font-semibold uppercase tracking-wider text-cta">Free</span>}
              </span>
              {!compact && selected.subtitle && <span className="mt-0.5 block break-all font-mono-arena text-[10px] leading-4 text-ink-3">{selected.subtitle}</span>}
            </>
          ) : (
            <span className="text-ink-3">{placeholder}</span>
          )}
        </span>
        <IconChevron className={`shrink-0 text-base text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-xl border border-line-strong bg-surface p-1.5 shadow-xl" role="listbox" aria-label={placeholder}>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
            {options.map((item) => {
              const active = String(item.id) === String(value)
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(String(item.id))
                    setOpen(false)
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${active ? 'bg-cta text-on-cta' : 'text-ink hover:bg-elevated'}`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${active ? 'bg-on-cta' : 'bg-ink-3/50'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold leading-5">
                      <span>{item.label}</span>
                      {item.free && <span className={`rounded-full px-2 py-0.5 font-mono-arena text-[10px] font-semibold uppercase tracking-wider ${active ? 'bg-on-cta/15 text-on-cta' : 'bg-cta/15 text-cta'}`}>Free</span>}
                    </span>
                    {item.subtitle && <span className={`mt-0.5 block break-all font-mono-arena text-[10px] leading-4 ${active ? 'text-on-cta/75' : 'text-ink-3'}`}>{item.subtitle}</span>}
                  </span>
                  {active && <span className="pt-0.5 text-sm" aria-label="Selected">✓</span>}
                </button>
              )
            })}
            {options.length === 0 && <p className="px-3 py-4 text-sm text-ink-3">No options available.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

import { IconDiscord, IconX } from './icons.jsx'

// Small social row, meant to sit in the sidebar footer above the Start
// Judging button. Each pill starts as a plain circle and grows sideways on
// hover/focus to reveal its label, tinting to the brand's own color — a
// little dock rather than a static badge. Staggered entrance on mount so
// the two pills pop in one after another (see .social-dock-item in
// theme.css).
const LINKS = [
  {
    // href: 'https://discord.com/invite/fhGPEaDJ5T',
    href: 'https://discord.com/invite/harness-arena',
    label: 'Join our Discord',
    Icon: IconDiscord,
    bg: '#5865F2',
  },
  {
    href: 'https://x.com/HarnessArenaHQ',
    label: 'Follow us on X',
    Icon: IconX,
    bg: '#0f0f0f',
  },
]

export default function SocialDock({ className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {LINKS.map(({ href, label, Icon, bg }, i) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          style={{ animationDelay: `${i * 150}ms`, '--dock-bg': bg }}
          className="social-dock-item group flex h-9 items-center rounded-full bg-elevated pr-0 text-ink-2 ring-1 ring-line transition-all duration-300 ease-out hover:bg-[var(--dock-bg)] hover:pr-3 hover:text-white hover:shadow-md hover:ring-transparent focus-visible:bg-[var(--dock-bg)] focus-visible:pr-3 focus-visible:text-white"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center text-base">
            <Icon />
          </span>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 transition-all duration-300 group-hover:max-w-[8rem] group-hover:opacity-100 group-focus-visible:max-w-[8rem] group-focus-visible:opacity-100">
            {label}
          </span>
        </a>
      ))}
    </div>
  )
}

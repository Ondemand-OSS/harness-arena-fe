// Small inline stroke icons, sized off the current font. Inline rather than
// an icon package so the bundle stays dependency-free and CSP-safe.

const base = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function IconEvaluate(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  )
}

export function IconLeaderboard(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 20V11M12 20V5M19 20v-6" />
    </svg>
  )
}

export function IconBattleLog(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h16M4 12h12M4 18h8" />
    </svg>
  )
}

export function IconMethodology(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </svg>
  )
}

export function IconSetup(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  )
}

export function IconHarness(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3l6 6 6-6M4 21l8-8 8 8" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  )
}

export function IconSun(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  )
}

export function IconMoon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12.8A8.5 8.5 0 1111.2 3a7 7 0 009.8 9.8z" />
    </svg>
  )
}

export function IconScales(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 5h5L5 8zM19 8l-2.5 5h5L19 8z" />
    </svg>
  )
}

export function IconChevron(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function IconActivity(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12h4l2 7 4-14 2 7h6" />
    </svg>
  )
}

export function IconEye(props) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function IconEyeOff(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3.1 3.9M6.4 6.4A15.7 15.7 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

export function IconCode(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 18l-6-6 6-6" />
      <path d="M15 6l6 6-6 6" />
    </svg>
  )
}

export function IconDownload(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  )
}

export function IconExternal(props) {
  return (
    <svg {...base} {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

export function IconBrowser(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18M7 6h.01M10 6h.01" />
    </svg>
  )
}

export function IconFolder(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 7a1 1 0 0 1 1-1h4.6a1 1 0 0 1 .8.4L11 8h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    </svg>
  )
}

export function IconFile(props) {
  return (
    <svg {...base} {...props}>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
      <path d="M14 3v4h4" />
    </svg>
  )
}

export function IconPaperclip(props) {
  return (
    <svg {...base} {...props}>
      <path d="M17.5 9.5l-7.6 7.6a3 3 0 0 1-4.24-4.24l8.13-8.13a2 2 0 0 1 2.83 2.83l-7.6 7.6a1 1 0 0 1-1.42-1.41l6.9-6.9" />
    </svg>
  )
}

export function IconClose(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function IconAlertTriangle(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5L2.5 20h19L12 3.5z" />
      <path d="M12 9.5v5" />
      <circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Filled rounded-triangle warning badge (currentColor body, white glyph) —
// reads as a caution icon rather than an error/stop sign.
export function IconWarningFilled(props) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        d="M12 3.3c.4 0 .8.2 1 .6l7.6 14.4c.5.9-.2 2-1.2 2H4.6c-1 0-1.7-1.1-1.2-2L11 3.9c.2-.4.6-.6 1-.6z"
        fill="currentColor"
      />
      <rect x="11" y="8.3" width="2" height="6.6" rx="1" fill="#fff" />
      <circle cx="12" cy="17.3" r="1.1" fill="#fff" />
    </svg>
  )
}

// Filled brand marks (currentColor), used at small sizes for the social
// links rather than the stroke-icon style above.
export function IconDiscord(props) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.3 5.4A18.8 18.8 0 0 0 15.7 4a13 13 0 0 0-.6 1.2 17.4 17.4 0 0 0-5.2 0A13 13 0 0 0 9.3 4a18.8 18.8 0 0 0-4.6 1.4C1.9 9.4 1.2 13.3 1.5 17.1a18.9 18.9 0 0 0 5.7 2.9c.5-.6.9-1.3 1.2-2a12.3 12.3 0 0 1-1.9-.9l.5-.4a13.5 13.5 0 0 0 11.6 0l.4.4c-.6.3-1.2.6-1.9.9.3.7.7 1.4 1.2 2a18.8 18.8 0 0 0 5.7-2.9c.4-4.4-.7-8.3-2.7-11.7ZM8.7 14.7c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Zm6.6 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Z" />
    </svg>
  )
}

export function IconX(props) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M13.7 10.6 20.6 2.7h-1.6l-6 6.9-4.8-6.9H2.5l7.2 10.4-7.2 8.2h1.6l6.4-7.3 5.1 7.3h5.7l-7.5-10.7Zm-2.3 2.6-.7-1L4.9 3.9h2.5l4.8 6.8.7 1 6.2 8.9h-2.5l-5.1-7.4Z" />
    </svg>
  )
}

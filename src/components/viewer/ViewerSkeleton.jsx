// Loading state for document previews.
export default function ViewerSkeleton({ progress = null, label = 'Loading preview…', pages = 2 }) {
  return (
    <div
      className="ha-page-stack"
      role="status"
      aria-live="polite"
      aria-label={progress == null ? label : `${label} ${progress}%`}
    >
      {Array.from({ length: pages }).map((_, p) => (
        <div className="ha-skeleton-page" key={p}>
          <div className="ha-skeleton-line ha-skeleton-title" />
          {Array.from({ length: 11 }).map((__, i) => (
            <div className="ha-skeleton-line" key={i} style={{ width: `${92 - (i % 4) * 12}%` }} />
          ))}
        </div>
      ))}
      <p className="flex items-center gap-2 font-mono-arena text-[11px] text-ink-2">
        <span>{label}</span>
        {progress != null && (
          <>
            <span aria-hidden="true" className="h-1 w-24 overflow-hidden rounded-full bg-line-strong">
              <span
                className="block h-full rounded-full bg-cta transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </span>
            <span>{progress}%</span>
          </>
        )}
      </p>
    </div>
  )
}

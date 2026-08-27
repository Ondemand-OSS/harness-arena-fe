// Shared preview error and recovery UI.
import { Component } from 'react'
import { api } from '../../api.js'

export function ViewerError({ error, deliverableId, filename, onRetry }) {
  const rawUrl = deliverableId != null ? api.deliverableUrl(deliverableId) : null
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" className="text-bad">
        <path
          d="M12 3 1.5 21h21L12 3Zm0 6.5v5.5m0 3v.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <p className="font-display text-base font-semibold text-ink">Preview unavailable for this artifact</p>
      <p className="max-w-md text-xs leading-relaxed text-ink-2">
        {error?.message || 'The preview service did not return a usable response.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {rawUrl && (
          <>
            <a
              className="btn-cta text-xs"
              href={rawUrl}
              download
              aria-label={filename ? `Download ${filename}` : 'Download this file'}
            >
              Download file
            </a>
            <a
              className="btn-secondary text-xs"
              href={rawUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={filename ? `Open ${filename} in a new tab` : 'Open this file in a new tab'}
            >
              Open in new tab
            </a>
          </>
        )}
        {onRetry && (
          <button type="button" className="btn-secondary text-xs" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

/** Scoped boundary: a renderer crash degrades to the recovery actions above
 *  rather than blanking the judging page. Re-keyed by deliverable id in the
 *  caller so switching artifacts clears a previous artifact's crash. */
export class ViewerErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ArtifactViewer]', this.props.filename, error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <ViewerError
          error={this.state.error}
          deliverableId={this.props.deliverableId}
          filename={this.props.filename}
          onRetry={() => this.setState({ error: null })}
        />
      )
    }
    return this.props.children
  }
}

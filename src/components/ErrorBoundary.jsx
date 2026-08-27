import { Component } from 'react'

/** Catches a render/lifecycle crash anywhere in its subtree instead of
 *  letting it propagate to the React root. Without this, ANY uncaught
 *  error below `main.jsx`'s single `ReactDOM.createRoot(...).render(<App
 *  />)` call unmounts the whole app, leaving a permanently blank page —
 *  React's own tree is gone, so no click (including "back") does anything
 *  until a real page reload re-initializes it from scratch. That's the
 *  actual mechanism behind "the page goes blank and only reload works",
 *  regardless of which specific interaction happened to trigger it.
 *
 *  Wrapped around the routed page content (not the sidebar/top bar) in
 *  App.jsx, and re-keyed by the current path — so a crash on one page
 *  doesn't take the whole app's chrome/navigation down with it: the rest
 *  of the UI stays clickable, and navigating to a different route mounts
 *  a fresh attempt instead of re-showing the same crash. */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // The one piece of information that actually pins down a fix — surfaced
    // to the console (and whatever error-reporting the deployment already
    // has wired to console.error) rather than only to this fallback UI.
    console.error('[ErrorBoundary] caught:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card mx-auto max-w-md space-y-3 p-6 text-center">
        <p className="eyebrow text-bad">Something went wrong</p>
        <h2 className="font-display text-lg font-semibold">This page hit an error</h2>
        <p className="text-sm text-ink-2">
          Try again, or reload if that doesn't help. Whatever you were looking at elsewhere in the
          app is unaffected.
        </p>
        <div className="flex items-center justify-center gap-3 pt-1">
          <button type="button" className="btn-cta text-sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button
            type="button"
            className="text-sm text-ink-2 hover:text-ink"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </div>
    )
  }
}

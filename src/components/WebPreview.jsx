import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { fetchArtifactText } from '../lib/artifactBlobs.js'
import AuthModal from './AuthModal.jsx'
import { IconChevron, IconCode, IconDownload, IconExternal, IconFile, IconFolder, IconWarningFilled } from './icons.jsx'
import { LoadingState } from './ui.jsx'

// Preview polling limits.
const POLL_TIMEOUT_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 3000

function ExpiryNote({ expiresAt }) {
  if (!expiresAt) return <>This preview is temporary and may expire.</>
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return <>This preview is temporary and may expire.</>
  return <>This preview expires around {date.toLocaleString()}.</>
}

function DownloadZipLink({ runId, className = 'text-sm text-link' }) {
  return (
    <a href={api.runProjectZipUrl(runId)} className={className} download>
      Download source (.zip)
    </a>
  )
}


// Source browser for web-project deliverables.

/** Extensions rendered inline as monospace text with line numbers. Anything
 *  else (images, PDF, xlsx…) gets an "open file" link instead: this pane is a
 *  source browser, not a replacement for the full artifact viewer. */
const TEXTISH = new Set([
  'jsx', 'js', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss', 'html', 'htm',
  'json', 'md', 'txt', 'yml', 'yaml', 'py', 'svg', 'sh', 'toml', 'env',
])

function extOf(name) {
  const i = (name || '').lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

/** Path used for the tree. The backend stores a nested `relpath` alongside
 *  the basename `filename`, but `DeliverableOut` only exposes `filename`
 *  today  -  so this prefers a nested field when one appears and degrades to
 *  a flat list of basenames when it doesn't, with no change needed here. */
function pathOf(file) {
  const raw = file.relpath || file.path || file.filename || ''
  return String(raw).replace(/\\/g, '/').replace(/^\.?\//, '')
}

/** Groups deliverable paths into a directory tree.
 *
 *  Each path is split on '/' and walked into nested `dir` nodes; the final
 *  segment becomes a `file` node carrying the deliverable itself. With flat
 *  basenames (today's API) every path is one segment, so the result is a
 *  flat list of file nodes and no folder rows are drawn  -  the same code
 *  path, not a special case. Directories sort before files, both A-Z. */
function buildTree(files) {
  const root = { name: '', path: '', type: 'dir', children: new Map() }
  for (const file of files) {
    const parts = pathOf(file).split('/').filter(Boolean)
    if (!parts.length) continue
    let node = root
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        node.children.set(part, { name: part, path: parts.join('/'), type: 'file', file })
        return
      }
      const dirPath = parts.slice(0, i + 1).join('/')
      if (!node.children.has(part) || node.children.get(part).type !== 'dir') {
        node.children.set(part, { name: part, path: dirPath, type: 'dir', children: new Map() })
      }
      node = node.children.get(part)
    })
  }
  const sortNode = (node) => {
    const kids = [...node.children.values()]
    kids.forEach((k) => k.type === 'dir' && sortNode(k))
    kids.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
    )
    node.list = kids
    return node
  }
  return sortNode(root).list
}

function collectDirPaths(nodes, out = []) {
  for (const node of nodes) {
    if (node.type !== 'dir') continue
    out.push(node.path)
    collectDirPaths(node.list, out)
  }
  return out
}

function TreeNode({ node, depth, activeId, expanded, onToggleDir, onSelect }) {
  const pad = { paddingLeft: 8 + depth * 12 }
  if (node.type === 'dir') {
    const open = expanded.has(node.path)
    return (
      <li>
        <button
          type="button"
          className="ha-tree-row"
          style={pad}
          aria-expanded={open}
          onClick={() => onToggleDir(node.path)}
        >
          <IconChevron className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          <IconFolder className="shrink-0 text-ink-3" />
          <span className="truncate">{node.name}/</span>
        </button>
        {open && (
          <ul>
            {node.list.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activeId={activeId}
                expanded={expanded}
                onToggleDir={onToggleDir}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }
  const on = node.file.id === activeId
  return (
    <li>
      <button
        type="button"
        className={`ha-tree-row ${on ? 'ha-tree-row-active' : ''}`}
        style={pad}
        aria-current={on ? 'true' : undefined}
        onClick={() => onSelect(node.file.id)}
      >
        <span className="shrink-0" style={{ width: '1em' }} />
        <IconFile className="shrink-0 text-ink-3" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  )
}

function CodeBody({ file }) {
  const [text, setText] = useState(null)
  const [error, setError] = useState('')
  const ext = extOf(file?.filename)
  const textish = TEXTISH.has(ext)

  useEffect(() => {
    if (!file || !textish) return undefined
    let cancelled = false
    const controller = new AbortController()
    setText(null)
    setError('')
    fetchArtifactText(file.id, { signal: controller.signal })
      .then((entry) => {
        if (!cancelled) setText(entry)
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return
        setError(err.message || 'Could not load this file.')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [file?.id, textish])

  if (!file) return <div className="p-4 text-sm text-ink-3">Select a file to view its source.</div>
  if (!textish) {
    return (
      <div className="space-y-2 p-4 text-sm text-ink-2">
        <p>
          <span className="font-mono-arena text-[12px] text-ink">{file.filename}</span> isn’t a text
          file, so it can’t be shown as source.
        </p>
        <a href={api.deliverableUrl(file.id)} target="_blank" rel="noreferrer" className="text-link">
          Open file ↗
        </a>
      </div>
    )
  }
  if (error) return <p className="p-4 text-sm text-bad">{error}</p>
  if (text == null) return <LoadingState label="Loading file…" compact />

  const lines = (text.text ?? '').split('\n')
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {text.truncated && (
        <p className="border-b border-line bg-floating px-3 py-1.5 text-[11px] text-ink-3">
          Showing the first {text.delivered.toLocaleString()} of {text.original.toLocaleString()}{' '}
          characters.{' '}
          <a href={api.deliverableUrl(file.id)} className="text-link" download={file.filename}>
            Download the whole file
          </a>
          .
        </p>
      )}
      <div className="ha-code p-3 text-ink-2">
        {lines.map((line, i) => (
          <div className="ha-code-row" key={i}>
            <span className="ha-code-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="ha-code-line">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Left file-explorer panel + right source pane. */
function CodeView({ files }) {
  const tree = useMemo(() => buildTree(files), [files])
  // Every folder open on arrival: these projects are a handful of files, and
  // a judge should see the whole shape without clicking anything.
  const [expanded, setExpanded] = useState(() => new Set(collectDirPaths(tree)))
  const [activeId, setActiveId] = useState(() => files[0]?.id ?? null)

  const active = files.find((f) => f.id === activeId) ?? files[0] ?? null

  const toggleDir = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  return (
    <div className="ha-web-code overflow-hidden rounded-lg border border-line">
      <nav className="ha-web-tree border-line bg-floating" aria-label="Project files">
        <p className="eyebrow px-3 pb-1 pt-3">File explorer</p>
        <ul className="pb-3">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              activeId={active?.id ?? null}
              expanded={expanded}
              onToggleDir={toggleDir}
              onSelect={setActiveId}
            />
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col bg-surface" style={{ minHeight: 480, maxHeight: 640 }}>
        <header className="shrink-0 truncate border-b border-line bg-elevated px-3 py-2 font-mono-arena text-[12px] text-ink">
          {active ? pathOf(active) : 'No file selected'}
        </header>
        <CodeBody key={active?.id ?? 'none'} file={active} />
      </div>
    </div>
  )
}

/** Read-only address bar with the deploy's URL and its two actions. */
function AddressBar({ url, runId }) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate rounded-lg border border-line bg-floating px-3 py-1.5 font-mono-arena text-[11px] text-ink-2">
        {url}
      </span>
      <a
        href={api.runProjectZipUrl(runId)}
        className="ha-tool"
        download
        title="Download source (.zip)"
        aria-label="Download source as a zip file"
      >
        <IconDownload />
      </a>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="ha-tool"
        title="Open in new tab"
        aria-label="Open the live preview in a new tab"
      >
        <IconExternal />
      </a>
    </div>
  )
}

/** "View website" action for a web-development run's deliverables (see
 *  backend/app/routers/deploy.py). Self-hides entirely for a non-web
 *  project, so it's safe to mount unconditionally on any done run. */
export default function WebPreview({ runId, files = [] }) {
  const { user } = useAuth()
  // 'preview' | 'code'. Preview is the default: the running site is what a
  // judge came for; the source is the follow-up question.
  const [view, setView] = useState('preview')
  // null while the initial GET hasn't resolved yet  -  distinct from "not a
  // web project", which the GET tells us explicitly.
  const [state, setState] = useState(null)
  const [showAuth, setShowAuth] = useState(false)
  const [deployError, setDeployError] = useState('')
  const pollTimer = useRef(null)
  const pollDeadline = useRef(0)
  const iframeRef = useRef(null)
  // Shown over the iframe until its load event fires, so a judge sees a
  // loader rather than nothing while it's fetching.
  const [iframeLoading, setIframeLoading] = useState(true)

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.runPreviewStatus(runId)
      setState(data)
      return data
    } catch {
      // A transient failure reading status shouldn't wipe out whatever we
      // already knew  -  just leave state as-is and let the next poll (or
      // the user re-clicking) try again.
      return null
    }
  }, [runId])

  useEffect(() => {
    let cancelled = false
    api
      .runPreviewStatus(runId)
      .then((data) => {
        if (cancelled) return
        setState(data)
        // A deploy kicked off before this mount (a previous visit, another
        // tab, or a mid-deploy page refresh) can still be running server-
        // side — the GET above just reports whatever it finds, it never
        // starts polling itself. Without this, the panel sits on the
        // "Starting preview…" spinner forever once that GET returns, since
        // nothing else ever calls it again; only clicking the button (via
        // start()) used to resume polling.
        if (data?.status === 'deploying') pollUntilSettled()
      })
      .catch(() => {
        if (!cancelled) setState({ is_web_project: false })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pollUntilSettled closes over
    // loadStatus/runId via refs and is stable for this component's lifetime; not a real dep.
  }, [runId])

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    },
    []
  )

  // sandbox_deploy.py's readiness check now confirms the app's actual JS
  // entry script is servable (not just that the root document returns
  // 200) before ever marking a deployment "live" — see _url_is_live. So
  // the iframe's first real load, once mounted, should just work; no
  // client-side forced-reload guess needed anymore (a previous version of
  // this did a blind timed reload to paper over the backend only checking
  // the root document, which was itself a guess about compile timing, not
  // a real readiness signal).
  useEffect(() => {
    if (!state?.preview_url) return undefined
    setIframeLoading(true)
    // Belt-and-suspenders: iframe onLoad is expected to clear the loader,
    // but a cross-origin sandbox occasionally doesn't fire it reliably —
    // never leave a judge staring at a spinner forever over that.
    const safety = setTimeout(() => setIframeLoading(false), 12_000)
    return () => clearTimeout(safety)
  }, [state?.preview_url])

  function handleIframeLoad() {
    setIframeLoading(false)
  }

  function pollUntilSettled() {
    pollDeadline.current = Date.now() + POLL_TIMEOUT_MS
    const tick = async () => {
      const data = await loadStatus()
      if (data && (data.status === 'live' || data.status === 'failed')) return
      if (Date.now() >= pollDeadline.current) {
        setState((prev) => ({ ...(prev ?? {}), status: 'failed', message: 'This is taking longer than expected. Download the source zip to run it locally.' }))
        return
      }
      pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS)
    }
    pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS)
  }

  async function start() {
    if (!user) {
      setShowAuth(true)
      return
    }
    setDeployError('')
    setState((prev) => ({ ...(prev ?? {}), status: 'deploying' }))
    try {
      const result = await api.startRunPreview(runId)
      // MERGE, never replace. POST /preview returns only the deploy's own
      // fields (run_id/status/preview_url/expires_at/message) — it does
      // not echo back `is_web_project`, `provider`, or `error_detail` the
      // way GET /preview does. Replacing state wholesale therefore left
      // `is_web_project` undefined, and the `if (!state.is_web_project)
      // return null` guard below then unmounted this whole panel the
      // instant a deploy/redeploy came back: the loader vanished into an
      // empty page, and only a reload (which re-runs the GET) brought it
      // back. Treat the POST response as the status delta it actually is.
      setState((prev) => ({ ...(prev ?? {}), ...result }))
      if (result.status === 'deploying') pollUntilSettled()
    } catch (err) {
      setDeployError(err.message || 'Could not start the preview.')
      setState((prev) => ({ ...(prev ?? {}), status: 'failed', message: '' }))
    }
  }

  if (state == null) return null
  if (!state.is_web_project) return null

  const status = state.status ?? 'idle'
  // The toggle only earns its space when BOTH halves have something to show:
  // a live URL to frame, and at least one deliverable to read.
  const canToggle = status === 'live' && Boolean(state.preview_url) && files.length > 0
  const showCode = canToggle && view === 'code'

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        {canToggle ? (
          <div className="ha-artifact-tabs" role="tablist" aria-label="Live preview or source code">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'preview'}
              className={`ha-tool ${view === 'preview' ? 'ha-tool-active' : ''}`}
              onClick={() => setView('preview')}
            >
              <Globe size={14} /> Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'code'}
              className={`ha-tool ${view === 'code' ? 'ha-tool-active' : ''}`}
              onClick={() => setView('code')}
            >
              <IconCode /> Code
            </button>
          </div>
        ) : (
          <p className="eyebrow">Live preview</p>
        )}
        {status === 'live' && !canToggle && <DownloadZipLink runId={runId} />}
      </div>

      {/* Known-broken before ever clicking Deploy — a source file
          references a sibling that was never generated, so every attempt
          would fail identically (see backend's undeployable_reason). No
          point offering a button that starts a guaranteed multi-minute
          failure; show why and let the zip stand in instead. Takes
          priority over the idle/failed/expired blocks below regardless
          of `status`, since redeploying can't fix this either. */}
      {state.blocked_reason ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2.5 text-warn">
            <IconWarningFilled className="shrink-0 text-lg" aria-hidden="true" />
            <span className="text-sm">{state.blocked_reason}</span>
          </div>
          <DownloadZipLink runId={runId} className="btn-secondary text-sm" />
        </div>
      ) : (status === 'idle' || status === 'failed') && (
        <div className="space-y-2">
          {status === 'failed' && (
            <p className="text-sm text-bad">{state.message || 'This project couldn’t be previewed.'}</p>
          )}
          {deployError && <p className="text-sm text-bad">{deployError}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-cta text-sm" onClick={start}>
              View website
            </button>
            {status === 'failed' && <DownloadZipLink runId={runId} className="btn-secondary text-sm" />}
          </div>
          {status === 'failed' && state.error_detail != null && (
            <pre className="max-h-40 overflow-auto rounded-lg border border-line bg-floating p-3 font-mono-arena text-[11px] leading-relaxed text-ink-3 whitespace-pre-wrap">
              {state.error_detail}
            </pre>
          )}
        </div>
      )}

      {/* Expiry is the NORMAL end of a sandbox's ~90-minute life, not a
          failure  -  so it gets the neutral notice treatment (border-line-strong
          / bg-floating / text-ink-2, the same vocabulary as ui.jsx's Notice)
          rather than the red `text-bad` copy and `error_detail` dump that
          `failed` uses. The project is intact; it only needs rebuilding, and
          the redeploy is the exact same POST-then-poll path as the first
          deploy, so the button just points at start(). */}
      {status === 'expired' && !state.blocked_reason && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg border border-line-strong bg-floating px-3 py-2 text-sm text-ink-2">
            <span aria-hidden="true">⏳</span>
            <span>
              {state.message || 'This preview has expired. Redeploy the project to generate a fresh preview.'}
            </span>
          </div>
          {deployError && <p className="text-sm text-bad">{deployError}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-cta text-sm" onClick={start}>
              Redeploy
            </button>
            <DownloadZipLink runId={runId} className="btn-secondary text-sm" />
          </div>
        </div>
      )}

      {status === 'deploying' && (
        <LoadingState label="Starting preview… this can take a minute or two" />
      )}

      {status === 'live' && canToggle && <AddressBar url={state.preview_url} runId={runId} />}

      {status === 'live' && showCode && <CodeView files={files} />}

      {status === 'live' && !showCode && (
        <div className="space-y-2">
          <div className="relative">
            <iframe
              ref={iframeRef}
              src={state.preview_url}
              title="Live website preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={handleIframeLoad}
              className="w-full rounded-lg border border-line"
              style={{ minHeight: 480 }}
            />
            {/* Covers the iframe (still mounted underneath, still loading)
                rather than replacing it — swapping it out of the tree
                would cancel its in-flight navigation and undo the
                auto-reload's timing. */}
            {iframeLoading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-line bg-floating">
                <LoadingState label="Loading preview…" compact />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
            {!canToggle && (
              <a href={state.preview_url} target="_blank" rel="noreferrer" className="text-link">
                Open in new tab ↗
              </a>
            )}
            <span className="ml-auto text-ink-3">
              <ExpiryNote expiresAt={state.expires_at} />
            </span>
          </div>
        </div>
      )}

      {showAuth && (
        <AuthModal
          reason="Sign in to deploy a live preview of this project."
          onClose={() => setShowAuth(false)}
          onSuccess={() => {
            setShowAuth(false)
            start()
          }}
        />
      )}
    </div>
  )
}

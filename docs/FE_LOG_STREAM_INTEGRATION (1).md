# Run logs — FE integration guide

How to show a run's live log while it's in progress. Use polling — an SSE
attempt was built and rejected, see §4 for why.

## 1. Endpoint

**`GET /api/runs/{run_id}/logs`**

Auth: normal `X-User-Token` header, exactly like every other endpoint —
nothing special needed. Open to any signed-in user, not scoped to the
caller's own runs (same as `GET /api/runs/{run_id}`).

Response, every time:

```json
{
  "status": "running",
  "raw_log": "...up to the last ~20,000 chars of output...",
  "deliverables_done": 2,
  "deliverables_expected": 4,
  "error_message": ""
}
```

`status` is one of `pending` / `running` / `done` / `error` / `stopped`.
Stop polling once it's `done`, `error`, or `stopped` — nothing more will
ever change on that run.

## 2. `raw_log` is a full snapshot, not a delta — read this before wiring up rendering

If the harness prints `a`, then later prints `b`, polls return:

```
poll 1 → raw_log: "a"
poll 2 → raw_log: "ab"      ← the whole thing so far, NOT just "b"
poll 3 → raw_log: "abc"
```

Every response is the complete accumulated text up to that point (oldest
bytes drop off the front once it passes ~20,000 chars) — never a chunk to
append. **Replace** whatever the log view is showing with `raw_log`
wholesale on every poll:

```js
logEl.textContent = data.raw_log   // correct
logEl.textContent += data.raw_log  // WRONG — duplicates on every poll
```

One upside of this shape: a missed poll (network blip, backgrounded tab)
never loses anything — the next successful poll just has the fuller
string. There's no gap to recover from, unlike a real delta/chunk stream.

## 3. FE usage

```js
function pollRunLog(runId, onUpdate, intervalMs = 1500) {
  let cancelled = false
  async function tick() {
    if (cancelled) return
    try {
      const res = await fetch(`/api/runs/${runId}/logs`, {
        headers: { 'X-User-Token': getToken() }, // however FE currently stores/reads it
      })
      if (res.ok) {
        const data = await res.json()
        onUpdate(data) // replace-not-append, see §2
        if (['done', 'error', 'stopped'].includes(data.status)) return // stop polling
      }
    } catch (e) {
      // transient network error — just try again next tick
    }
    if (!cancelled) setTimeout(tick, intervalMs)
  }
  tick()
  return () => { cancelled = true } // call to stop early, e.g. on modal close
}

// usage:
const stopPolling = pollRunLog(runId, (data) => {
  logEl.textContent = data.raw_log
  updateProgress(data.deliverables_done, data.deliverables_expected)
})
// later: stopPolling()
```

Add to `src/api.js`:

```js
runLog: (runId) => request('GET', `/api/runs/${runId}/logs`),
```

## 4. Why polling, not SSE

An SSE endpoint (`GET /api/runs/{run_id}/logs/stream`) exists in the
codebase but is confirmed broken on this app's `serverless.on-demand.io`
deployment: something in front of the app buffers the entire response and
delivers nothing to the client until the connection closes. Verified
directly against a genuinely running, actively-changing run:

```
$ curl -v .../api/runs/294/logs/stream?token=...
* Operation timed out after 8001 milliseconds with 0 bytes received
```

Not even the first event (sent immediately on connect) got through — not
fixable from the app side, the platform is holding the response back
regardless of what's sent. Polling has no dependency on the platform
supporting long-held connections at all — it's the same request/response
shape every other endpoint here already uses successfully.

## 5. Known issue — not yet fixed on deployed staging as of this doc

A battle runs all its harnesses concurrently, currently sharing one
internal settings object. Until a pending fix is deployed, only **one**
harness per battle gets its own live log written correctly while running
— the others either stay empty or get another harness's output mixed into
theirs. This only affects the incremental view of a still-`running` run;
once a run reaches `done`/`error`, its `raw_log` is always correct
regardless. If a run's live log looks empty or like the wrong harness's
output while `status: running`, that's this, not a bug in the polling
endpoint itself.

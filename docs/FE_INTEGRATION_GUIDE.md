# Battle Log — BE pagination integration guide

Scope: what actually changed on BE (commit `9e13802`), what FE (`harness-arena-fe`) currently does, and where the filter mismatch is coming from.

## 1. What changed on BE

Only one endpoint changed: `GET /api/tasks`. Two new **optional** query params:

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int | `1` | 1-indexed. Ignored unless `limit` is also passed. |
| `limit` | int | `None` (no pagination) | Clamped to `1..50`. Omit it entirely to get the old unpaginated behavior — every existing caller is unaffected. |

Nothing else changed. `POST /api/runs/overview` has **no pagination** — it still takes a full `task_ids` array and returns overview data for all of them in one shot. If FE paginates `/api/tasks`, only the `id_aa`s from that page should be sent to `/api/runs/overview`, not the full task list — otherwise the latency problem this was meant to fix comes right back.

Pagination is applied **after** the `group` filter (group is derived, not a stored field) but is otherwise a plain in-memory slice — it does not know about status/outcome/sort at all.

## 2. What FE currently does (unchanged)

`harness-arena-fe/src/pages/BattleLog.jsx` does not use `page`/`limit` yet:

- `api.listTasks({ includeDeleted: isAdmin })` — fetches **all** tasks, no `page`/`limit`/`category`/`group`.
- `api.runsOverview(tasks.map(t => t.id_aa))` — sends every task id from the full list.
- Status/Category/Outcome/Sort filters, and the "hide Not run" rule, are all computed **client-side** in `buildRows()` / the `shown` useMemo — see `src/pages/BattleLog.jsx`.

So today, none of the BE filter/pagination params reach BattleLog at all. `src/api.js`'s `listTasks` already forwards `category`/`group`/`include_deleted` in its query string builder, it's just that `BattleLog.jsx` never passes them.

## 3. Filters BE actually supports (source of the FE/BE mismatch)

| Filter | BE support | Values | Where |
|---|---|---|---|
| `category` | ✅ exact match on `task.category` | any string from `GET /api/tasks/categories` | `GET /api/tasks?category=...` |
| `group` | ✅ derived post-filter | `Code`, `Research`, `Analysis & Risk`, `Operations`, `Other` | `GET /api/tasks?group=...` |
| `include_deleted` | ✅ admin-only, 403 otherwise | `true`/`false` | `GET /api/tasks?include_deleted=true` |
| `page`, `limit` | ✅ new | int, `limit` capped at 50 | `GET /api/tasks?page=1&limit=6` |
| **status** | ❌ not a BE param anywhere | — | computed FE-only from `POST /api/runs/overview`'s `runs`/`compare` |
| **outcome** | ❌ not a BE param anywhere | — | computed FE-only from `compare.entries[].already_scored` |
| **sort** | ❌ not a BE param anywhere | — | computed FE-only from `run.finished_at`/`started_at` |

**This is the mismatch to flag to Mayank/FE:** `status`, `outcome`, and `sort` don't exist as BE filters today — they only exist as values computed client-side after `POST /api/runs/overview` returns. If FE tries to pass `?status=judged` or similar to `GET /api/tasks`, it'll be silently ignored (FastAPI drops unknown query params). Only `category`, `group`, `include_deleted`, `page`, `limit` do anything server-side.

Practical consequence: paginating `GET /api/tasks` with `limit=6` and then filtering that page by status/outcome client-side will produce wrong/short pages (a page of 6 tasks could have 0 that pass the status filter). Real fix needs status/outcome/sort to move server-side (into `/api/runs/overview` or a combined endpoint) before this is safe to ship as "real" pagination — flagged in `harness-ai-battle-log.md`.

## 4. curl commands to test

Base URL: `https://serverless.on-demand.io/apps/harness-arena` (prod) or `http://localhost:8000` (local BE).

```bash
BASE=http://localhost:8000

# all tasks, unpaginated (old behavior, still default)
curl -s "$BASE/api/tasks" | jq 'length'

# paginated: page 1, 6 per page
curl -s "$BASE/api/tasks?page=1&limit=6" | jq '.[].id_aa'

# page 2
curl -s "$BASE/api/tasks?page=2&limit=6" | jq '.[].id_aa'

# limit over the cap (50) — gets clamped to 50
curl -s "$BASE/api/tasks?limit=500" | jq 'length'

# category filter
curl -s "$BASE/api/tasks?category=Market%20Commercialization" | jq '.[].id_aa'

# group filter
curl -s "$BASE/api/tasks?group=Research" | jq '.[].id_aa'

# category + pagination together
curl -s "$BASE/api/tasks?group=Research&page=1&limit=6" | jq '.[].id_aa'

# include_deleted — needs an admin token, 403 without one
curl -s "$BASE/api/tasks?include_deleted=true" \
  -H "X-User-Token: <admin_token>" | jq '.[].id_aa'

# available category/group values (for building the dropdown lists)
curl -s "$BASE/api/tasks/categories" | jq
curl -s "$BASE/api/tasks/groups" | jq

# runs overview — unpaginated by design, only send the ids on the current page
curl -s -X POST "$BASE/api/runs/overview" \
  -H "Content-Type: application/json" \
  -d '{"task_ids": ["task_id_1", "task_id_2"]}' | jq
```

## 5. `GET /api/runs/board` — the real fix (combined task+overview, server-side filters)

Added on top of section 1-4's partial `/api/tasks?page&limit`. Replaces the
`GET /api/tasks` + `POST /api/runs/overview` pair in one call, with
`status`/`outcome`/`sort` resolved **before** pagination (port of
`buildRows()`/`resolveRowStatus()` from `BattleLog.jsx`), so a page always
has exactly `limit` matching rows.

**Endpoint:** `GET /api/runs/board`

| Param | Type | Notes |
|---|---|---|
| `category` | str | same as `/api/tasks` |
| `group` | str | same as `/api/tasks` — this is Evaluate's `group` filter |
| `include_deleted` | bool | admin-only |
| `status` | str | one of the 9 `STATUS_FILTERS` values from section 3; unknown value → `400` |
| `outcome` | `Decisive`\|`Tie` | unknown value → `400` |
| `sort` | `asc`\|`desc` | default `desc`, by `latest_run_at` |
| `page`, `limit` | int | `limit` capped at 50, default 6 |

**Response:** `{ rows: [...], total, page, limit }`. Each row = the task
(full `TaskOut`) + one round's data: `row_key`, `round_id`, `status`,
`outcome`, `margin`, `latest_run_at`, `is_primary_card`, `entries`,
`progress_entries`, `failed_entries`. Rows with status `Not run` are
already excluded — no client-side filter needed for that.

FE helper already added: `api.runsBoard({ category, group, includeDeleted, status, outcome, sort, page, limit })` in `src/api.js`.

**Verified against real seed data:** unfiltered total = 30 (matches the
147→30 funnel from section 4), `page=1`/`page=2` return disjoint `row_key`s,
`sort=asc`/`desc` order correctly, `group=Research` filters correctly,
bad `status` → `400` instead of being silently dropped.

**Not wired into `BattleLog.jsx` yet** — endpoint exists and is tested, but
the page still does the old fetch-all-and-filter-locally flow. Swapping it
in is mechanical: call `api.runsBoard({...filters, page})` instead of
`listTasks`+`runsOverview`, drop the local `useMemo` filter/sort/slice, use
`total` for the "Showing X of Y" count.

## 6. BE done, FE change NOT made — `HarnessProfile.jsx`'s N+1

`HarnessProfile.jsx` currently calls `listTasks()` (all tasks) then
`Promise.all(tasks.map(task => api.compare(task.id_aa)))` — one full
`GET /api/compare/{id}` round-trip per task, just to find which tasks this
harness won/lost/tied. That FE code is still exactly as it was — only the
backend side was built and verified:

- **New endpoint (live):** `GET /api/harnesses/{key}/battles` → `[{ task, score, result }]`, `result` is `Win`\|`Loss`\|`Tie`. Built on the same bulk overview builder `/api/runs/board` uses (`_build_overviews`), so it's a fixed handful of queries regardless of task count instead of one per task.
- Verified locally: `GET /api/harnesses/claude-code/battles` → `200`, correct empty-array behavior for an anonymous caller (same as before — `revealed` requires the viewer to have scored) and for an unknown harness key.

```bash
curl -s "$BASE/api/harnesses/claude-code/battles"
```

**FE change needed (not yet made):**

1. Add to `src/api.js`:
   ```js
   harnessBattles: (key) => request('GET', `/api/harnesses/${encodeURIComponent(key)}/battles`),
   ```
2. In `HarnessProfile.jsx`, replace the `listTasks()` + `Promise.all(...compare...)` effect body with:
   ```js
   api.harnessBattles(id).then((rows) => { if (!cancelled) setBattles(rows) }).catch(() => {})
   ```
   Row shape (`task`, `score`, `result`) is identical to what the effect produces today, so nothing downstream (the `battles.map(...)` render block) needs to change.

## 7. Evaluate.jsx / Benchmark.jsx — deliberately NOT changed

- **`Evaluate.jsx`**: does the same `listTasks`+`runsOverview` shape as
  BattleLog, but its judging logic (`comparisonGroups`/`judgeableGroups`,
  "every profile group that qualifies for judging", not just the current
  one) needs the **full `runs`+`history` arrays across every round**.
  `/api/runs/board` deliberately collapses each task down to one row per
  *resolved* round (same scoping `POST /api/runs/overview`'s `compare` does)
  — swapping Evaluate to it would silently drop older/alternate judgeable
  profile groups and break "Judge" for tasks with more than one battle.
  Needs a variant that returns raw runs/history per task, not the collapsed
  board row shape — not attempted here to avoid breaking judging.
- **`Benchmark.jsx`**: already calls `runsOverview` once in bulk and only
  reads `.runs` off each row (not the heavier `compare` data) — it's not
  paying for anything it doesn't use. No `status`/`outcome`/`sort`
  filtering happens there, so `/api/runs/board` isn't a correctness win,
  only a maybe-pagination one. Left as-is.
- **`Eval.jsx`**: `listTasks()` alone, no per-task loop attached — cheap, no fix needed.

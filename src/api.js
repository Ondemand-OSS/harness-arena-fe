// API base URL. Leave unset for local development. 
const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') ?? ''

// Remove legacy client-side session data.
try {
  localStorage.removeItem('ha-user-token')
} catch {
  /* Web Storage may be disabled; there is nothing else to migrate. */
}

function url(path) {
  return `${API_BASE}${path}`
}

const REFRESH_TOKEN_KEY = 'ha-refresh-token'

function readStoredRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY) || null
  } catch {
    return null
  }
}

// Keep access tokens in memory and refresh sessions when needed.
let accessToken = null
let refreshToken = readStoredRefreshToken()
let refreshPromise = null

export const setUserToken = (token) => {
  accessToken = token || null
}
export const getUserToken = () => accessToken

export const setRefreshToken = (token) => {
  refreshToken = token || null
  try {
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    else localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    /* Web Storage may be disabled; the in-memory value still works for this tab. */
  }
}

function headers(hasBody) {
  const h = {}
  if (hasBody) h['Content-Type'] = 'application/json'
  if (accessToken) h['X-User-Token'] = accessToken
  return h
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    // Avoid a refresh request when no session is available.
    if (!refreshToken) throw new Error('session expired')
    const res = await fetch(url('/api/users/session/refresh'), {
      method: 'POST',
      headers: { 'x-refresh-token': refreshToken },
    })
    if (!res.ok) {
      setUserToken(null)
      setRefreshToken(null)
      throw new Error('session expired')
    }
    const session = await res.json()
    setUserToken(session.access_token)
    // Store the rotated refresh token.
    if (session.refresh_token) setRefreshToken(session.refresh_token)
    return session
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

async function request(method, path, body, retryAfterRefresh = true) {
  const res = await fetch(url(path), {
    method,
    headers: headers(Boolean(body)),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && retryAfterRefresh) {
    try {
      await refreshAccessToken()
      return request(method, path, body, false)
    } catch {
      // Use the original request error when refresh fails.
    }
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch {
      /* ignore non-JSON error bodies */
    }
    // Convert structured error details into a readable message.
    if (typeof detail !== 'string') {
      detail = Array.isArray(detail)
        ? detail.map((d) => (typeof d === 'string' ? d : d?.msg || JSON.stringify(d))).join('; ')
        : JSON.stringify(detail)
    }
    if (
      typeof window !== 'undefined' &&
      (res.status === 429 || /daily limit reached|active-task limit|task in progress/i.test(detail))
    ) {
      window.dispatchEvent(new CustomEvent('arena:rate-limit', { detail }))
    }
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

async function requestText(path, retryAfterRefresh = true) {
  const res = await fetch(url(path), { headers: headers(false) })
  if (res.status === 401 && retryAfterRefresh) {
    try {
      await refreshAccessToken()
      return requestText(path, false)
    } catch {
      // Use the original response error when refresh fails.
    }
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail || detail
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.text()
}

export const api = {
  listTasks: ({ category, group, includeDeleted = false, page, limit } = {}) => {
    const qs = new URLSearchParams()
    if (category) qs.set('category', category)
    if (group) qs.set('group', group)
    if (includeDeleted) qs.set('include_deleted', 'true')
    if (page != null) qs.set('page', page)
    if (limit != null) qs.set('limit', limit)
    const suffix = qs.toString()
    return request('GET', `/api/tasks${suffix ? `?${suffix}` : ''}`)
  },
  listCategories: (group) =>
    request('GET', `/api/tasks/categories${group ? `?group=${encodeURIComponent(group)}` : ''}`),
  listGroups: () => request('GET', '/api/tasks/groups'),
  stats: () => request('GET', '/api/stats'),
  getTask: (id) => request('GET', `/api/tasks/${encodeURIComponent(id)}`),
  importDefaultDataset: () => request('POST', '/api/tasks/import-default'),
  datasetTemplateUrl: () => url('/api/tasks/template.xlsx'),
  listCategoryReviews: () => request('GET', '/api/tasks/category-reviews'),
  approveCategoryReview: (key, group) => request('PUT', `/api/tasks/category-reviews/${encodeURIComponent(key)}/approve`, { group }),
  deleteTaskResults: (id) => request('DELETE', `/api/tasks/${encodeURIComponent(id)}/results`),
  deleteTask: (id) => request('DELETE', `/api/tasks/${encodeURIComponent(id)}`),
  restoreTask: (id) => request('POST', `/api/tasks/${encodeURIComponent(id)}/restore`),
  resetScores: (taskId) => request('POST', `/api/scores/reset/${encodeURIComponent(taskId)}`),
  uploadDataset: async (file) => {
    const form = new FormData()
    form.append('file', file)
    // No Content-Type: the browser must set the multipart boundary itself.
    const res = await fetch(url('/api/tasks/import'), {
      method: 'POST',
      body: form,
      headers: headers(false),
    })
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText)
    return res.json()
  },

  // Reference files attached to a task.
  listReferenceFiles: (taskId) => request('GET', `/api/tasks/${encodeURIComponent(taskId)}/reference-files`),
  uploadReferenceFile: async (taskId, file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(url(`/api/tasks/${encodeURIComponent(taskId)}/reference-files`), {
      method: 'POST',
      body: form,
      headers: headers(false),
    })
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText)
    return res.json()
  },
  deleteReferenceFile: (taskId, fileId) =>
    request('DELETE', `/api/tasks/${encodeURIComponent(taskId)}/reference-files/${fileId}`),
  getReferenceFileContent: (taskId, fileId) =>
    requestText(`/api/tasks/${encodeURIComponent(taskId)}/reference-files/${fileId}/content`),

  // Account and session endpoints.
  requestSignupVerification: (username, email, password, displayName) =>
    request('POST', '/api/users/signup/request-verification', { username, email, password, display_name: displayName }, false),
  verifySignup: (email, code) => request('POST', '/api/users/signup/verify', { email, code }, false),
  userLogin: (username, password) => request('POST', '/api/users/login', { username, password }, false),
  refreshSession: refreshAccessToken,
  logoutSession: async () => {
    try {
      // Session logout uses the refresh token.
      if (refreshToken) {
        await fetch(url('/api/users/session/logout'), {
          method: 'POST',
          headers: { 'x-refresh-token': refreshToken },
        })
      }
    } finally {
      setUserToken(null)
      setRefreshToken(null)
    }
  },
  me: () => request('GET', '/api/users/me'),

  // User-managed provider credentials.
  setOndemandApiKey: (apiKey) => request('PUT', '/api/users/me/ondemand-key', { api_key: apiKey }),
  listUserLimitOverrides: () => request('GET', '/api/users/admin/limits'),
  updateUserLimitOverride: (userId, limits) => request('PUT', `/api/users/admin/limits/${userId}`, limits),

  // Available provider models.
  listOndemandModels: () => request('GET', '/api/ondemand-models'),
  createOndemandModel: (body) => request('POST', '/api/ondemand-models', body),
  updateOndemandModel: (id, body) => request('PUT', `/api/ondemand-models/${id}`, body),
  setOndemandModelEnabled: (id, enabled) => request('PUT', `/api/ondemand-models/${id}/enabled`, { enabled }),
  deleteOndemandModel: (id) => request('DELETE', `/api/ondemand-models/${id}`),
  getOndemandSuggestPlugins: () => request('GET', '/api/ondemand-models/suggest-plugins'),
  setOndemandSuggestPlugins: (enabled) => request('PUT', '/api/ondemand-models/suggest-plugins', { enabled }),

  listConfigs: () => request('GET', '/api/config'),
  createConfig: (cfg) => request('POST', '/api/config', cfg),
  updateConfig: (id, cfg) => request('PUT', `/api/config/${id}`, cfg),
  deleteConfig: (id) => request('DELETE', `/api/config/${id}`),
  // Enable or disable a shared profile.
  setConfigEnabled: (id, enabled) => request('PUT', `/api/config/${id}/enabled`, { enabled }),

  listHarnesses: () => request('GET', '/api/harnesses'),
  listCustomHarnesses: () => request('GET', '/api/harnesses/custom'),
  createCustomHarness: (body) => request('POST', '/api/harnesses/custom', body),
  updateCustomHarness: (key, body) => request('PUT', `/api/harnesses/custom/${encodeURIComponent(key)}`, body),
  deleteCustomHarness: (key) => request('DELETE', `/api/harnesses/custom/${encodeURIComponent(key)}`),

  triggerRun: (taskId, harnessKeys, force = false, providerConfigId = null, ondemandModelId = null) =>
    request('POST', '/api/runs', {
      task_id: taskId,
      harness_keys: harnessKeys ?? null,
      force,
      provider_config_id: providerConfigId,
      ondemand_model_id: ondemandModelId,
    }),
  listRunsForTask: (taskId, providerConfigId = null) =>
    request('GET', `/api/runs/by-task/${encodeURIComponent(taskId)}${providerConfigId != null ? `?provider_config_id=${providerConfigId}` : ''}`),
  // Full run history for a task.
  listRunHistoryForTask: (taskId, providerConfigId = null) =>
    request(
      'GET',
      `/api/runs/by-task/${encodeURIComponent(taskId)}/history${providerConfigId != null ? `?provider_config_id=${providerConfigId}` : ''}`
    ),
  // Bulk task run summary.
  runsOverview: (taskIds) => request('POST', '/api/runs/overview', { task_ids: taskIds }),
  // Combined task list + run overview with server-side filters and pagination.
  runsBoard: ({ category, group, includeDeleted = false, status, outcome, sort = 'desc', page = 1, limit = 6 } = {}) => {
    const qs = new URLSearchParams()
    if (category) qs.set('category', category)
    if (group) qs.set('group', group)
    if (includeDeleted) qs.set('include_deleted', 'true')
    if (status) qs.set('status', status)
    if (outcome) qs.set('outcome', outcome)
    if (sort) qs.set('sort', sort)
    if (page != null) qs.set('page', page)
    if (limit != null) qs.set('limit', limit)
    const suffix = qs.toString()
    return request('GET', `/api/runs/board${suffix ? `?${suffix}` : ''}`)
  },
  getRun: (id) => request('GET', `/api/runs/${id}`),
  runLog: (runId) => request('GET', `/api/runs/${runId}/logs`),
  // Retry a failed run.
  retryRun: (runId) => request('POST', `/api/runs/${runId}/retry`),
  stopRun: (runId) => request('POST', `/api/runs/${runId}/stop`),
  deleteFailedRun: (runId) => request('DELETE', `/api/runs/${runId}`),
  deleteRound: (roundId) => request('DELETE', `/api/runs/round/${encodeURIComponent(roundId)}`),
  // Administrative run summary.
  adminListRuns: ({ status, limit = 100 } = {}) => {
    const qs = new URLSearchParams()
    if (status) qs.set('status', status)
    if (limit) qs.set('limit', limit)
    const suffix = qs.toString()
    return request('GET', `/api/runs/admin/overview${suffix ? `?${suffix}` : ''}`)
  },
  deliverableUrl: (id) => url(`/api/runs/deliverable/${id}/content`),
  deliverableInlineUrl: (id) => url(`/api/runs/deliverable/${id}/content?inline=true`),
  deliverablePptxPreviewUrl: (id) => url(`/api/runs/deliverable/${id}/pptx-preview.pdf`),
  deliverablePreview: (id) => request('GET', `/api/runs/deliverable/${id}/preview`),

  // Preview lifecycle endpoints.
  runPreviewStatus: (runId) => request('GET', `/api/runs/${runId}/preview`),
  startRunPreview: (runId) => request('POST', `/api/runs/${runId}/preview`),
  // Download URL for a web project.
  runProjectZipUrl: (runId) => url(`/api/runs/${runId}/project.zip`),

  submitBatch: (taskIds, harnessKeys, providerConfigId = null, ondemandModelId = null) =>
    request('POST', '/api/batches', {
      task_ids: taskIds,
      harness_keys: harnessKeys ?? null,
      provider_config_id: providerConfigId,
      ondemand_model_id: ondemandModelId,
    }),
  listBatches: (activeOnly) => request('GET', `/api/batches${activeOnly ? '?active_only=true' : ''}`),
  getBatch: (id) => request('GET', `/api/batches/${id}`),

  compare: (taskId, providerConfigId = null, runIds = null, includeCommunityStats = false) => {
    const params = new URLSearchParams()
    if (providerConfigId != null) params.set('provider_config_id', providerConfigId)
    if (runIds?.length) params.set('run_ids', runIds.join(','))
    if (includeCommunityStats) params.set('include_community_stats', 'true')
    const suffix = params.toString()
    return request('GET', `/api/scores/compare/${encodeURIComponent(taskId)}${suffix ? `?${suffix}` : ''}`)
  },
  nextUnjudged: () => request('GET', '/api/scores/next-unjudged'),
  submitScores: (taskId, scores, providerConfigId = null, runIds = null) =>
    request('POST', '/api/scores', { task_id: taskId, scores, provider_config_id: providerConfigId, run_ids: runIds }),

  leaderboard: (group) => request('GET', `/api/leaderboard${group ? `?group=${encodeURIComponent(group)}` : ''}`),
  harnessProfile: (key) => request('GET', `/api/leaderboard/harness/${encodeURIComponent(key)}`),
}

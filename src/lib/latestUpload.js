const STORAGE_KEY = 'arena:latest-upload-task-ids'
const DATASET_VERSION_KEY = 'arena:latest-upload-dataset-version'

let memoryIds = []
let memoryDatasetVersion = ''

/** Task IDs created by the most recent dataset upload in this browser. */
export function readLatestUploadTaskIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    /* Storage may be unavailable; retain the in-memory value instead. */
  }
  return new Set(memoryIds)
}

export function writeLatestUploadTaskIds(ids) {
  memoryIds = [...ids]
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryIds))
  } catch {
    /* Storage may be unavailable; the in-memory value still works this session. */
  }
}

export function readLatestUploadDatasetVersion() {
  try {
    return localStorage.getItem(DATASET_VERSION_KEY) || memoryDatasetVersion
  } catch {
    return memoryDatasetVersion
  }
}

export function writeLatestUploadDatasetVersion(datasetVersion) {
  memoryDatasetVersion = datasetVersion || ''
  try {
    if (memoryDatasetVersion) localStorage.setItem(DATASET_VERSION_KEY, memoryDatasetVersion)
    else localStorage.removeItem(DATASET_VERSION_KEY)
  } catch {
    /* Storage may be unavailable; the in-memory value still works this session. */
  }
}

// Keep this aligned with backend/app/webproject.py's is_web_project().
const DEPLOY_FILENAMES = new Set(['package.json'])
const DEPLOY_EXTENSIONS = new Set(['.jsx', '.tsx', '.vue', '.svelte', '.astro'])
const DEPLOY_STEMS = new Set(['vite.config', 'next.config', 'nuxt.config', 'svelte.config', 'astro.config'])

function taskFiles(task) {
  if (Array.isArray(task?.deliverable_files) && task.deliverable_files.length) return task.deliverable_files
  return String(task?.expected_deliverables ?? '').split(',')
}

export function isWebProjectTask(task) {
  return taskFiles(task).some((file) => {
    const basename = String(file).trim().replaceAll('\\', '/').split('/').pop().toLowerCase()
    if (!basename) return false
    if (DEPLOY_FILENAMES.has(basename)) return true
    const dot = basename.lastIndexOf('.')
    const extension = dot >= 0 ? basename.slice(dot) : ''
    const stem = dot >= 0 ? basename.slice(0, dot) : basename
    return DEPLOY_EXTENSIONS.has(extension) || DEPLOY_STEMS.has(stem)
  })
}

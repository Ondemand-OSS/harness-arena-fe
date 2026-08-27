import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function TaskPromptModal({ task, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4">
      {/* `fixed`, not `absolute` — see ModelPickerModal's identical backdrop
          for why: `absolute` here only covers one viewport-height, not the
          full scrollable dialog (this one especially, for a long prompt). */}
      <button
        type="button"
        className="fixed inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
        aria-label="Close task details"
        onClick={onClose}
      />
      <div className="relative z-10 flex min-h-full items-start justify-center py-6 sm:items-center">
        <section role="dialog" aria-modal="true" aria-labelledby="task-prompt-title" className="card w-full max-w-3xl p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Task details</p>
              <h2 id="task-prompt-title" className="font-display mt-1 text-2xl font-semibold">{task.title}</h2>
            </div>
            <button type="button" className="btn-secondary px-3 py-1.5" aria-label="Close task details" onClick={onClose}>×</button>
          </div>
          <div className="mt-5 space-y-5">
            <div>
              <p className="eyebrow">System prompt</p>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-floating p-3 font-sans text-sm leading-relaxed text-ink-2">{task.system_prompt || 'No system prompt provided.'}</pre>
            </div>
            <div>
              <p className="eyebrow">Task prompt</p>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-floating p-3 font-sans text-sm leading-relaxed text-ink-2">{task.prompt || 'No task prompt provided.'}</pre>
            </div>
          </div>
        </section>
      </div>
    </div>,
    document.body
  )
}

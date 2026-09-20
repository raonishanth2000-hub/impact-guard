import { useEffect } from 'react'
import { Check, TriangleAlert, X } from 'lucide-react'

/**
 * Transient confirmation. role="status" with aria-live="polite" so it is
 * announced without stealing focus mid-task.
 */
export default function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onDismiss, 4500)
    return () => clearTimeout(timer)
  }, [toast, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2"
    >
      {toast && (
        <div className="lift pointer-events-auto flex items-center gap-3 rounded-button
                        border border-rule bg-surface py-2.5 pl-3.5 pr-2"
             style={{ boxShadow: 'var(--shadow-raised)' }}>
          {toast.tone === 'warn'
            ? <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true"
                             className="shrink-0 text-warning-ink" />
            : <Check size={15} strokeWidth={2.25} aria-hidden="true"
                     className="shrink-0 text-positive" />}

          <span className="text-[13px] text-ink">{toast.message}</span>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className="ml-1 rounded-control p-1 text-ink-3 transition-colors duration-150
                       cursor-pointer hover:bg-sunken hover:text-ink"
          >
            <X size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

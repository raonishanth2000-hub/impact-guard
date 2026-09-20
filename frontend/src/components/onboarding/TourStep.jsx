import { useEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button } from '../primitives'

/**
 * The tour card: title, body, progress, controls.
 *
 * Positioned beside the highlighted element when there is one, centred when
 * there is not. Positioning is arithmetic on a measured rect, clamped to the
 * viewport, so a target near an edge still produces a readable card.
 *
 * Styling is the app's own: rounded-card, border-rule, bg-surface, the
 * existing Button. No new palette and no new radius.
 */

const GAP = 14
const WIDTH = 348

function place(rect, vw, vh) {
  if (!rect) {
    return { centred: true }
  }

  // Prefer below, then above, then centred — whichever has room.
  const below = vh - rect.bottom
  const above = rect.top
  const width = Math.min(WIDTH, vw - 32)

  let top
  if (below > 210) top = rect.bottom + GAP
  else if (above > 210) top = Math.max(16, rect.top - 210 - GAP)
  else return { centred: true }

  // Centre horizontally on the target, then clamp inside the viewport.
  const wanted = rect.left + rect.width / 2 - width / 2
  const left = Math.max(16, Math.min(wanted, vw - width - 16))
  return { top, left, width }
}

export default function TourStep({
  step, index, total, rect,
  onNext, onBack, onSkip, onFinish, onDemo,
}) {
  const cardRef = useRef(null)

  // Move focus to the card on every step so a keyboard user follows along and
  // Escape/Enter reach the handler without hunting for focus.
  useEffect(() => {
    cardRef.current?.focus()
  }, [index])

  const pos = place(rect, window.innerWidth, window.innerHeight)
  const last = index === total - 1
  const style = pos.centred
    ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: Math.min(WIDTH + 40, window.innerWidth - 32) }
    : { top: pos.top, left: pos.left, width: pos.width }

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      className="fixed z-[70] rounded-card border border-rule bg-surface p-5 shadow-raised
                 outline-none transition-[top,left] duration-200 ease-out
                 motion-reduce:transition-none"
      style={style}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {step.eyebrow && (
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-3">
              {step.eyebrow}
            </div>
          )}
          <h2 id="tour-title"
              className={`text-ink ${pos.centred
                ? 'mt-1.5 text-[19px] font-semibold tracking-[-0.015em]'
                : 'mt-1.5 text-[15px] font-semibold'}`}>
            {step.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip tour"
          className="-mr-1 -mt-1 shrink-0 rounded-control p-1 text-ink-3 transition-colors
                     duration-150 cursor-pointer hover:bg-sunken hover:text-ink"
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {step.subtitle && (
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{step.subtitle}</p>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{step.body}</p>

      {step.example && (
        <pre className="mt-3 overflow-x-auto rounded-control bg-sunken px-3 py-2.5
                        font-mono text-[11.5px] leading-relaxed text-ink-2">
{step.example}
        </pre>
      )}

      {/* Progress: a counter for certainty, a bar for shape. */}
      <div className="mt-4 flex items-center gap-2.5">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300
                          ease-out motion-reduce:transition-none"
               style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <span className="shrink-0 font-mono text-[11px] text-ink-3 tnum">
          {index + 1} of {total}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-control text-[12.5px] text-ink-3 transition-colors duration-150
                     cursor-pointer hover:text-ink focus-visible:outline-2
                     focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
        >
          Skip tour
        </button>

        <div className="flex items-center gap-2">
          {index > 0 && !last && (
            <Button variant="secondary" size="sm" onClick={onBack}>
              <ArrowLeft size={13} strokeWidth={1.75} aria-hidden="true" />
              Back
            </Button>
          )}

          {last ? (
            <>
              <Button variant="secondary" size="sm" onClick={onFinish}>
                Explore dashboard
              </Button>
              <Button variant="primary" size="sm" onClick={onDemo}>
                Try demo incident
                <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={onNext}>
              {index === 0 ? 'Start tour' : 'Next'}
              <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

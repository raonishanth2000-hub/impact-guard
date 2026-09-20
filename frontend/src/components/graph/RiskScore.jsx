import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Incident risk.
 *
 * The number is NOT new: it is the highest score the deterministic engine gave
 * any pre-incident change, shown larger. The "Why?" disclosure lists that
 * change's actual scoring reasons, so the figure is always traceable.
 *
 * Counts up on mount because the value arrives with an analysis, and a number
 * that lands rather than appears reads as a measurement.
 */
const BAND = {
  high:   { label: 'High attention',   text: 'text-accent-ink', bar: 'bg-accent' },
  medium: { label: 'Worth reviewing',  text: 'text-warning-ink', bar: 'bg-warning' },
  low:    { label: 'Low',              text: 'text-ink-2',       bar: 'bg-ink-3/50' },
  none:   { label: 'No candidates',    text: 'text-ink-3',       bar: 'bg-rule' },
}

export default function RiskScore({ risk, compact = false }) {
  const [shown, setShown] = useState(0)
  const [open, setOpen] = useState(false)
  const raf = useRef(null)

  useEffect(() => {
    const target = risk?.score ?? 0
    if (target === 0) { setShown(0); return }

    const started = performance.now()
    const DURATION = 900
    const tick = (now) => {
      const t = Math.min(1, (now - started) / DURATION)
      // easeOutCubic — decelerates into the final value
      setShown(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)

    // rAF is paused in a non-compositing tab; land on the value regardless.
    const fallback = setTimeout(() => setShown(target), DURATION + 250)
    return () => { cancelAnimationFrame(raf.current); clearTimeout(fallback) }
  }, [risk?.score])

  if (!risk) return null
  const band = BAND[risk.band] || BAND.none

  return (
    <div className={compact ? '' : 'rounded-card border border-rule bg-surface p-4 shadow-subtle'}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-3">
        Change risk
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-[34px] leading-none tracking-[-0.02em] text-ink tnum">
          {shown}
        </span>
        <span className="font-mono text-[13px] text-ink-3">/ 100</span>
      </div>

      <div className={`mt-1.5 text-[12.5px] font-medium ${band.text}`}>{band.label}</div>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunken" role="presentation">
        <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${band.bar}`}
             style={{ width: `${shown}%` }} />
      </div>

      {risk.factors?.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-3 inline-flex items-center gap-1 text-[12px] text-ink-2
                       transition-colors duration-150 cursor-pointer hover:text-ink"
          >
            Why?
            <ChevronDown size={12} strokeWidth={2} aria-hidden="true"
                         className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="lift mt-2 border-t border-rule-soft pt-2.5">
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                Highest-scoring change before the incident:{' '}
                <span className="font-mono text-ink-2">{risk.lead?.resource_id}</span>
              </p>
              <ul className="mt-2 space-y-1.5">
                {risk.factors.map((f, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-snug text-ink-2">
                    <span aria-hidden="true"
                          className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${band.bar}`} />
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
                Every point traces to a scoring rule. No part of this is model output.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

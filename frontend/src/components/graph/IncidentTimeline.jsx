import { useEffect, useMemo, useRef } from 'react'
import { relevanceStyle, formatClock } from '../../lib/format'

/**
 * Horizontal incident timeline.
 *
 * Markers sit at their true elapsed-time position, so clustering before the
 * incident stays visible rather than being flattened into even spacing. That
 * creates a label-collision problem: several changes land within a couple of
 * minutes of each other, and fixed-width labels centred on those points overlap
 * into mush.
 *
 * Rather than evenly spacing the markers (which would destroy the signal) or
 * truncating harder (which makes every label unreadable), labels are packed
 * into stacked rows: each one takes the highest row where it does not collide
 * with the previous label in that row, connected back to its marker by a
 * leader line.
 */

const LABEL_W = 118
const GAP = 14
// Must exceed the rendered label height (time line + title + padding ≈ 41px),
// or stacked rows overlap by a few pixels and the packing looks broken.
const ROW_H = 50
const RAIL_Y = 7

export default function IncidentTimeline({ timeline, activeId, onSelect, cutoffTime }) {
  const scroller = useRef(null)
  const activeRef = useRef(null)

  const { placed, innerWidth, rowCount, min, span } = useMemo(() => {
    if (!timeline?.length) return { placed: [], innerWidth: 0, rowCount: 0, min: 0, span: 1 }

    const times = timeline.map((e) => new Date(e.time).getTime())
    const min = Math.min(...times)
    const max = Math.max(...times)
    const span = Math.max(1, max - min)

    // Widen the canvas as events multiply so packing has room to work.
    const innerWidth = Math.max(760, timeline.length * 104)
    const usable = innerWidth - LABEL_W

    const rowEnds = []
    const placed = timeline
      .map((entry, i) => ({ entry, i, t: new Date(entry.time).getTime() }))
      .sort((a, b) => a.t - b.t)
      .map(({ entry, t }) => {
        const x = ((t - min) / span) * usable + LABEL_W / 2
        const left = x - LABEL_W / 2

        let row = rowEnds.findIndex((end) => left >= end + GAP)
        if (row === -1) { row = rowEnds.length; rowEnds.push(0) }
        rowEnds[row] = x + LABEL_W / 2

        return { entry, x, row }
      })

    return { placed, innerWidth, rowCount: Math.max(1, rowEnds.length), min, span }
  }, [timeline])

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [activeId])

  if (!timeline?.length) return null

  const cutoff = cutoffTime ? new Date(cutoffTime).getTime() : null
  const height = RAIL_Y + 14 + rowCount * ROW_H

  return (
    <div className="rounded-card border border-rule bg-surface shadow-subtle">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule px-4 py-2.5">
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Incident timeline</h3>
        <span className="font-mono text-[11px] text-ink-3 tnum">
          {formatClock(timeline[0].time)} – {formatClock(timeline[timeline.length - 1].time)}
        </span>
      </div>

      <div ref={scroller} className="overflow-x-auto px-4 pb-4 pt-4">
        <div className="relative" style={{ width: innerWidth, height }}>
          <div className="absolute left-0 right-0 bg-rule" style={{ top: RAIL_Y, height: 1 }}
               aria-hidden="true" />

          {cutoff !== null && (
            <div className="absolute left-0 bg-accent/55 transition-[width] duration-300 ease-out"
                 style={{
                   top: RAIL_Y, height: 1,
                   width: `${Math.max(0, Math.min(100, ((cutoff - min) / span) * 100))}%`,
                 }}
                 aria-hidden="true" />
          )}

          <ol>
            {placed.map(({ entry, x, row }, i) => {
              const isIncident = entry.type === 'incident'
              const active = activeId === entry.event_id
              const t = new Date(entry.time).getTime()
              const faded = cutoff !== null && t > cutoff
              const labelTop = RAIL_Y + 14 + row * ROW_H

              const dot = isIncident ? 'bg-severe'
                : entry.relevance === 'HIGH' ? 'bg-accent'
                : entry.relevance === 'MEDIUM' ? 'bg-warning'
                : 'bg-ink-3/45'

              return (
                <li key={entry.event_id ?? i}
                    className="transition-opacity duration-300"
                    style={{ opacity: faded ? 0.28 : 1 }}>
                  {/* leader line from marker down to its packed label row */}
                  <span
                    className="absolute w-px bg-rule"
                    style={{ left: x, top: RAIL_Y + 5, height: labelTop - RAIL_Y - 5 }}
                    aria-hidden="true"
                  />

                  <span
                    className={`absolute rounded-full border-[3px] border-surface
                                transition-transform duration-200 ${dot}
                                ${active ? 'scale-125' : ''}`}
                    style={{ left: x - 7, top: RAIL_Y - 7, width: 14, height: 14 }}
                    aria-hidden="true"
                  />

                  <button
                    ref={active ? activeRef : null}
                    type="button"
                    onClick={() => onSelect?.(entry)}
                    aria-current={active ? 'true' : undefined}
                    title={entry.label}
                    className={`absolute rounded-control px-1.5 py-1 text-center transition-colors
                                duration-150 cursor-pointer hover:bg-sunken
                                ${active ? 'bg-sunken' : ''}`}
                    style={{ left: x - LABEL_W / 2, top: labelTop, width: LABEL_W }}
                  >
                    <time dateTime={entry.time}
                          className={`block font-mono text-[11px] tnum ${
                            isIncident ? 'font-semibold text-severe'
                            : active ? 'text-ink' : 'text-ink-3'}`}>
                      {formatClock(entry.time)}
                    </time>
                    <span className={`mt-0.5 block truncate text-[11px] leading-tight ${
                      isIncident ? 'font-medium text-severe'
                      : active ? 'text-ink' : 'text-ink-2'}`}>
                      {entry.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}

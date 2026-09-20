import { useMemo } from 'react'
import { ServiceIcon } from '../primitives'

/**
 * Topology canvas.
 *
 * Hand-rolled rather than React Flow. The graph is ten nodes and a handful of
 * evidenced edges whose positions we already compute deterministically in
 * layoutTopology, so the library was buying pan/zoom we do not need at the cost
 * of ~200KB and an edge renderer that would not draw. Plain SVG for the links,
 * absolutely-positioned cards for the nodes, one CSS transform for focus.
 *
 * Node state comes from the ranking engine. We never claim "healthy" for a
 * resource we have no signal on.
 */

const NODE_W = 204
const NODE_H = 86
const PAD = 56

const STATE = {
  attention: { dot: 'bg-accent',     label: 'Needs attention', text: 'text-accent-ink' },
  changed:   { dot: 'bg-warning',    label: 'Changed',         text: 'text-warning-ink' },
  quiet:     { dot: 'bg-ink-3/45',   label: 'Minor change',    text: 'text-ink-3' },
}

/** Horizontal cubic bezier between two node cards. */
function edgePath(a, b) {
  const x1 = a.x + NODE_W
  const y1 = a.y + NODE_H / 2
  const x2 = b.x
  const y2 = b.y + NODE_H / 2
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export default function TopologyCanvas({
  nodes, edges, focusId, focusSet, revealed, pulsingId,
  onSelectNode, onSelectEdge, onClearFocus,
}) {
  // Normalise to a positive coordinate space and size the canvas to fit.
  const { placed, width, height } = useMemo(() => {
    if (!nodes.length) return { placed: [], width: 0, height: 0 }
    const minX = Math.min(...nodes.map((n) => n.position.x))
    const minY = Math.min(...nodes.map((n) => n.position.y))
    const placed = nodes.map((n) => ({
      ...n,
      x: n.position.x - minX + PAD,
      y: n.position.y - minY + PAD,
    }))
    return {
      placed,
      width: Math.max(...placed.map((n) => n.x)) + NODE_W + PAD,
      height: Math.max(...placed.map((n) => n.y)) + NODE_H + PAD,
    }
  }, [nodes])

  const byId = useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed])

  if (!placed.length) return null

  return (
    <div
      className="relative h-full w-full overflow-auto"
      onClick={onClearFocus}
      role="group"
      aria-label="Resource topology"
    >
      <div className="relative" style={{ width, height }}>
        {/* Links sit behind the cards. */}
        <svg
          className="absolute inset-0 overflow-visible"
          width={width} height={height}
          aria-hidden="true"
        >
          <defs>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
            </marker>
            <marker id="arrow-idle" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-rule)" />
            </marker>
          </defs>

          {edges.map((e) => {
            const a = byId.get(e.source)
            const b = byId.get(e.target)
            if (!a || !b) return null

            const inFocus = focusSet ? (focusSet.has(e.source) && focusSet.has(e.target)) : true
            const inTime = revealed ? (revealed.has(e.source) && revealed.has(e.target)) : true
            const active = inFocus && inTime
            const d = edgePath(a, b)
            const mid = { x: (a.x + NODE_W + b.x) / 2, y: (a.y + b.y) / 2 + NODE_H / 2 }

            return (
              <g key={e.id} className="transition-opacity duration-300"
                 style={{ opacity: active ? 1 : 0.18 }}>
                {/* Wide invisible hit area — a 1.5px line is not clickable. */}
                <path
                  d={d} fill="none" stroke="transparent" strokeWidth={16}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onClick={(ev) => { ev.stopPropagation(); onSelectEdge?.(e.evidence) }}
                />
                <path
                  d={d} fill="none"
                  stroke={active ? 'var(--color-accent)' : 'var(--color-rule)'}
                  strokeWidth={active ? 1.6 : 1.2}
                  strokeDasharray={e.evidence.kind === 'port' ? '5 4' : undefined}
                  markerEnd={`url(#${active ? 'arrow-active' : 'arrow-idle'})`}
                  className="pointer-events-none"
                />
                <g className="pointer-events-none" transform={`translate(${mid.x}, ${mid.y})`}>
                  <rect x={-34} y={-9} width={68} height={17} rx={3}
                        fill="var(--color-surface)" stroke="var(--color-rule)" strokeWidth={0.75} />
                  <text textAnchor="middle" y={3}
                        style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9.5,
                                 fill: 'var(--color-ink-2)' }}>
                    {e.evidence.label}
                  </text>
                </g>
              </g>
            )
          })}
        </svg>

        {/* Resource cards */}
        {placed.map((n) => {
          const s = STATE[n.state] || STATE.quiet
          const dimmed = (focusSet && !focusSet.has(n.id)) || (revealed && !revealed.has(n.id))
          const focused = focusId === n.id

          return (
            <button
              key={n.id}
              type="button"
              onClick={(ev) => { ev.stopPropagation(); onSelectNode?.(n.id) }}
              aria-pressed={focused}
              className={`absolute rounded-card border bg-surface px-3 py-2.5 text-left
                          transition-all duration-200 cursor-pointer
                          ${dimmed ? 'opacity-25' : 'opacity-100'}
                          ${focused
                            ? 'border-accent shadow-raised ring-2 ring-accent/35'
                            : 'border-rule shadow-subtle hover:border-ink-3/45 hover:shadow-raised'}`}
              style={{
                left: n.x, top: n.y, width: NODE_W, height: NODE_H,
                transform: focused ? 'scale(1.04)' : undefined,
              }}
            >
              {pulsingId === n.id && (
                <span className="node-pulse pointer-events-none absolute -inset-1 rounded-card
                                 ring-2 ring-accent/50" aria-hidden="true" />
              )}

              <div className="flex items-center gap-2">
                <span className="text-ink-3"><ServiceIcon service={n.service} size={13} /></span>
                <span className="truncate text-[11px] font-medium text-ink-2">{n.serviceLabel}</span>
                {n.production && (
                  <span className="ml-auto rounded-control bg-sunken px-1.5 py-0.5 font-mono
                                   text-[9.5px] uppercase tracking-[0.06em] text-ink-2">
                    prod
                  </span>
                )}
              </div>

              <div className="mt-1.5 truncate font-mono text-[12.5px] text-ink" title={n.id}>
                {n.id}
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} aria-hidden="true" />
                <span className={`text-[11px] ${s.text}`}>{s.label}</span>
                {n.changeCount > 1 && (
                  <span className="ml-auto font-mono text-[10.5px] text-ink-3">
                    {n.changeCount} changes
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, RotateCcw, Info, X } from 'lucide-react'

import { Button } from '../components/primitives'
import TopologyCanvas from '../components/graph/TopologyCanvas'
import RiskScore from '../components/graph/RiskScore'
import IncidentTimeline from '../components/graph/IncidentTimeline'
import { useInvestigation } from '../state/InvestigationContext'
import {
  buildTopology, layoutTopology, incidentRisk, neighboursOf,
} from '../lib/topology'
import { formatClock } from '../lib/format'

const REPLAY_STEP_MS = 1400

function Canvas() {
  const { result, openDetail, selectedId } = useInvestigation()

  const [focusId, setFocusId] = useState(null)
  const [activeEventId, setActiveEventId] = useState(null)
  const [replayIndex, setReplayIndex] = useState(null) // null = not replaying
  const [cutoffIndex, setCutoffIndex] = useState(null) // time machine, null = show all
  const [edgeNote, setEdgeNote] = useState(null)
  const timer = useRef(null)

  const topology = useMemo(() => buildTopology(result?.changes ?? []), [result])
  const positioned = useMemo(() => layoutTopology(topology.nodes), [topology.nodes])
  const risk = useMemo(() => incidentRisk(result?.changes ?? []), [result])

  const timeline = result?.timeline ?? []
  const cutoffTime = cutoffIndex === null ? null : timeline[cutoffIndex]?.time

  // Resources whose change has already happened at the current cutoff.
  const revealed = useMemo(() => {
    if (cutoffTime === null) return null
    const cut = new Date(cutoffTime).getTime()
    const ids = new Set()
    for (const c of result?.changes ?? []) {
      if (new Date(c.event_time).getTime() <= cut) ids.add(c.resource_id)
    }
    return ids
  }, [cutoffTime, result])

  const focusSet = useMemo(
    () => (focusId ? neighboursOf(topology.edges, focusId) : null),
    [focusId, topology.edges],
  )

  // The resource whose change is firing in this replay step.
  const pulsingId = useMemo(() => {
    if (replayIndex === null) return null
    const entry = timeline[replayIndex]
    if (!entry || entry.type !== 'change') return null
    return result?.changes?.find((c) => c.event_id === entry.event_id)?.resource_id ?? null
  }, [replayIndex, timeline, result])

  // Our canvas takes the derived topology directly; no adapter layer needed.
  const graphNodes = positioned
  const graphEdges = topology.edges

  /** Focus Mode: highlight a resource and its evidenced neighbours. */
  const focusResource = useCallback((id) => {
    setFocusId(id)
    // Open the investigation panel on that resource's most relevant change.
    const change = topology.nodes.find((n) => n.id === id)?.topChange
    if (change) openDetail(change.event_id)
  }, [topology.nodes, openDetail])

  const clearFocus = useCallback(() => setFocusId(null), [])

  /** Timeline selection drives graph focus and the panel. */
  const selectEvent = useCallback((entry) => {
    setActiveEventId(entry.event_id)
    if (entry.type === 'incident') { clearFocus(); return }
    const change = result?.changes?.find((c) => c.event_id === entry.event_id)
    if (change?.resource_id) focusResource(change.resource_id)
  }, [result, focusResource, clearFocus])

  // ---- Replay ------------------------------------------------------------
  const stopReplay = useCallback(() => {
    clearInterval(timer.current)
    timer.current = null
    setReplayIndex(null)
  }, [])

  const startReplay = useCallback(() => {
    stopReplay()
    setFocusId(null)
    setCutoffIndex(0)
    setReplayIndex(0)

    let i = 0
    timer.current = setInterval(() => {
      i += 1
      if (i >= timeline.length) {
        clearInterval(timer.current); timer.current = null
        setReplayIndex(null)
        setCutoffIndex(null)   // end on the full picture
        return
      }
      setReplayIndex(i)
      setCutoffIndex(i)
      setActiveEventId(timeline[i].event_id)
      // Deliberately no focus during replay. Focus dims everything except one
      // node's neighbourhood, which fights the reveal — the environment should
      // visibly build up as the story runs, with only the firing node pulsing.
    }, REPLAY_STEP_MS)
  }, [timeline, result, stopReplay])

  useEffect(() => () => clearInterval(timer.current), [])

  const replaying = replayIndex !== null

  if (!positioned.length) {
    return (
      <div className="rounded-card border border-dashed border-rule px-6 py-20 text-center">
        <h2 className="text-[15px] font-semibold text-ink">No resources to map</h2>
        <p className="mx-auto mt-2 max-w-[48ch] text-[13px] leading-relaxed text-ink-2">
          This investigation returned no identifiable resources, so there is nothing to draw.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {replaying ? (
          <Button variant="secondary" onClick={stopReplay}>
            <Square size={13} strokeWidth={2} aria-hidden="true" />
            Stop replay
          </Button>
        ) : (
          <Button variant="primary" onClick={startReplay}>
            <Play size={13} strokeWidth={2} aria-hidden="true" />
            Replay incident
          </Button>
        )}

        {(focusId || cutoffIndex !== null) && (
          <Button variant="tertiary" onClick={() => { clearFocus(); setCutoffIndex(null); setActiveEventId(null) }}>
            <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
            Reset view
          </Button>
        )}

        <div className="ml-auto flex items-center gap-4 text-[11.5px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Needs attention
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
            Changed
          </span>
          <span className="hidden sm:inline">{topology.edges.length} evidenced links</span>
        </div>
      </div>

      {/* Time machine */}
      <div className="flex items-center gap-3 rounded-card border border-rule bg-surface px-4 py-2.5">
        <label htmlFor="time-machine"
               className="shrink-0 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">
          Time machine
        </label>
        <input
          id="time-machine"
          type="range"
          min={0}
          max={timeline.length - 1}
          value={cutoffIndex === null ? timeline.length - 1 : cutoffIndex}
          onChange={(e) => { stopReplay(); setCutoffIndex(Number(e.target.value)) }}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-sunken
                     accent-[var(--color-accent)]"
        />
        <span className="w-[86px] shrink-0 text-right font-mono text-[12px] text-ink tnum">
          {formatClock(timeline[cutoffIndex === null ? timeline.length - 1 : cutoffIndex]?.time)}
          {cutoffIndex === null && <span className="ml-1 text-ink-3">all</span>}
        </span>
      </div>

      {/* Graph + risk */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_248px]">
        <div className="relative h-[460px] overflow-hidden rounded-card border border-rule
                        bg-sunken/40 shadow-subtle">
          <TopologyCanvas
            nodes={graphNodes}
            edges={graphEdges}
            focusId={focusId}
            focusSet={focusSet}
            revealed={revealed}
            pulsingId={pulsingId}
            onSelectNode={focusResource}
            onSelectEdge={setEdgeNote}
            onClearFocus={clearFocus}
          />

          {focusId && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-control
                            bg-surface/95 px-2.5 py-1.5 text-[11.5px] text-ink-2 shadow-subtle">
              Focus: <span className="font-mono text-ink">{focusId}</span>
              <span className="ml-2 text-ink-3">click empty space to exit</span>
            </div>
          )}

          {edgeNote && (
            <div className="absolute bottom-3 left-3 right-3 flex gap-2.5 rounded-control
                            border border-rule bg-surface px-3 py-2.5 shadow-raised lift">
              <Info size={13} strokeWidth={1.75} aria-hidden="true"
                    className="mt-[3px] shrink-0 text-ink-3" />
              <p className="flex-1 text-[11.5px] leading-relaxed text-ink-2">
                <span className="font-medium text-ink">Why this link exists.</span>{' '}
                {edgeNote.detail}
              </p>
              <button type="button" onClick={() => setEdgeNote(null)}
                      aria-label="Dismiss link evidence"
                      className="shrink-0 rounded-control p-1 text-ink-3 cursor-pointer
                                 hover:bg-sunken hover:text-ink">
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <RiskScore risk={risk} />
          <div className="rounded-card border border-rule bg-surface p-4 shadow-subtle">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-3">
              How links are drawn
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
              CloudTrail records API calls, not architecture. Every edge here is
              backed by something literally present in a change payload — a
              resource id inside another resource's parameters, or a database
              port opened on a security group.
            </p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              Click any edge to see its evidence. Relationships we cannot evidence
              are not drawn.
            </p>
          </div>
        </div>
      </div>

      <IncidentTimeline
        timeline={timeline}
        activeId={activeEventId ?? selectedId}
        onSelect={selectEvent}
        cutoffTime={cutoffTime}
      />
    </div>
  )
}

export default function GraphPage() {
  return (
    <div className="space-y-6">
      <header>
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
          Investigation
        </div>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.015em] text-ink">
          Change topology
        </h1>
        <p className="mt-2 max-w-[68ch] text-[13.5px] leading-relaxed text-ink-2">
          Every resource touched in this window, and the links we can actually evidence
          from the change payloads. Click a resource to focus it and open its
          investigation, or replay the incident to watch the sequence unfold.
        </p>
      </header>

      <Canvas />
    </div>
  )
}

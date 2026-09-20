import { useEffect, useRef } from 'react'
import { X, ArrowRight, TriangleAlert, ClipboardCheck, User , ChevronDown } from 'lucide-react'
import { DataRow, RelevanceBadge, ServiceIcon, Tag } from './primitives'
import {
  formatClock12, formatFull, formatOffset, isProduction, relevanceStyle,
  serviceLabel, SIGNAL_LABELS,
} from '../lib/format'

function Group({ title, children }) {
  return (
    <section className="border-t border-rule px-5 py-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {title}
      </h3>
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

/**
 * A Group that starts closed.
 *
 * The panel showed nine sections at once, three of them raw technical record —
 * request parameters, resource identifiers, and the caller's IP, user agent
 * and timestamp. That is the evidence, and it has to stay reachable, but it is
 * not what a reader needs in the first ten seconds. Closing it by default puts
 * the plain-language answers first without removing anything.
 *
 * Deliberately <details> rather than state: it is keyboard and screen-reader
 * accessible without any work, and find-in-page still reaches the contents.
 */
function CollapsibleGroup({ title, children }) {
  return (
    <details className="group/disc border-t border-rule">
      <summary className="flex cursor-pointer list-none items-center justify-between
                          gap-3 px-5 py-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          {title}
        </h3>
        <ChevronDown
          size={14} strokeWidth={1.75} aria-hidden="true"
          className="shrink-0 text-ink-3 transition-transform duration-150
                     group-open/disc:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="px-5 pb-4">{children}</div>
    </details>
  )
}

/** Render a request parameter value compactly; objects fall back to JSON. */
function paramValue(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Change detail panel.
 *
 * A note on "what changed": CloudTrail records the API *request*, not a diff of
 * the resource. We therefore show the values that were submitted, labelled as
 * such. Presenting a fabricated before/after would be inventing data the
 * control plane never gave us.
 */
export default function ChangeDetail({ change, onClose }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  // Held in a ref so an unstable onClose identity cannot re-run the effect
  // below. Re-running it would re-capture restoreRef from whatever happened to
  // be focused mid-session, losing the element that actually opened the panel.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const changeId = change?.event_id

  useEffect(() => {
    if (!changeId) return

    closeRef.current?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const focusables = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables?.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      // Focus restoration is handled by closeDetail in InvestigationContext,
      // which knows which element opened this panel.
    }
    // Keyed on the id, not the object or the callback: the effect should run
    // exactly once per opened change.
  }, [changeId])

  if (!change) return null

  const s = relevanceStyle(change.relevance)
  const prod = isProduction(change.resource_id)
  const n = change.narrative
  const params = change.change_detail || {}
  const hasParams = Object.keys(params).length > 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} aria-hidden="true" />

      <aside
        ref={panelRef}
        role="dialog"
        data-tour="detail"
        aria-modal="true"
        aria-labelledby="detail-title"
        className="slide-in relative flex h-full w-full max-w-[460px] flex-col
                   border-l border-rule bg-surface"
        style={{ boxShadow: 'var(--shadow-panel)' }}
      >
        <header className="flex items-start justify-between gap-4 px-5 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <RelevanceBadge relevance={change.relevance} showPhrase />
              {prod && <Tag>Production</Tag>}
            </div>

            <h2 id="detail-title"
                className="mt-3 text-[18px] font-semibold leading-snug tracking-[-0.01em] text-ink">
              {change.action_summary}
            </h2>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
              <time dateTime={change.event_time} className="font-mono tnum text-ink">
                {formatClock12(change.event_time)}
              </time>
              <span className="text-rule" aria-hidden="true">|</span>
              <span className="inline-flex items-center gap-1.5">
                <ServiceIcon service={change.aws_service} size={12} className="text-ink-3" />
                {serviceLabel(change.aws_service)}
              </span>
              <span className="text-rule" aria-hidden="true">|</span>
              <span className="font-mono">{change.actor}</span>
            </div>
          </div>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close change details"
            className="shrink-0 rounded-control p-1.5 text-ink-2 transition-colors
                       duration-150 cursor-pointer hover:bg-sunken hover:text-ink"
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {n && (
            <>
              <Group title="In plain terms">
                <p className="text-[13.5px] leading-relaxed text-ink">{n.plain}</p>
                <p className="mt-2 flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
                  <User size={13} strokeWidth={1.75} aria-hidden="true"
                        className="mt-0.5 shrink-0 text-ink-3" />
                  {n.actor_plain}
                </p>
              </Group>

              <Group title="Before and after">
                <div className="overflow-hidden rounded-control border border-rule">
                  <div className="bg-sunken/50 px-3 py-2.5">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
                      Before
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{n.before}</p>
                  </div>
                  <div className="flex items-center gap-2 border-y border-rule bg-surface px-3 py-1.5">
                    <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true"
                                className="text-accent-ink" />
                    <span className="text-[11px] text-ink-3">this change</span>
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
                      After
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{n.after}</p>
                  </div>
                </div>

                {/* The gap is stated rather than hidden. */}
                {!n.before_known && (
                  <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-3">
                    The exact previous values are not recoverable here: the change log
                    records what was requested, not what the setting was beforehand.
                    Check the resource’s own history for the old value.
                  </p>
                )}
              </Group>

              <Group title="What could go wrong">
                <ul className="space-y-2">
                  {n.risks.map((r, i) => (
                    <li key={i} className="flex gap-2.5">
                      <TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true"
                                     className="mt-[3px] shrink-0 text-warning-ink" />
                      <span className="text-[12.5px] leading-relaxed text-ink-2">{r}</span>
                    </li>
                  ))}
                </ul>
              </Group>

              <Group title="Recommended checks">
                <ol className="space-y-2">
                  {n.checklist.map((c, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-[2px] w-4 shrink-0 font-mono text-[11px] text-ink-3 tnum">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[12.5px] leading-relaxed text-ink-2">{c}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 flex gap-2.5 rounded-control bg-accent-wash px-3 py-2.5">
                  <ClipboardCheck size={13} strokeWidth={1.75} aria-hidden="true"
                                  className="mt-[3px] shrink-0 text-accent-ink" />
                  <p className="text-[12.5px] leading-relaxed text-ink">
                    <span className="font-medium">Do this next.</span> {n.recommend}
                  </p>
                </div>
              </Group>
            </>
          )}

          <CollapsibleGroup title="What was requested">
            {hasParams ? (
              <>
                <dl className="divide-y divide-rule-soft">
                  {Object.entries(params).map(([key, value]) => (
                    <DataRow key={key} label={key} value={paramValue(value)} />
                  ))}
                </dl>
                <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                  These are the exact values the caller submitted — the technical
                  record behind the plain description above.
                </p>
              </>
            ) : (
              <p className="text-[12.5px] text-ink-2">
                This event carried no request parameters worth surfacing.
              </p>
            )}
          </CollapsibleGroup>

          <CollapsibleGroup title="Resource">
            <dl className="divide-y divide-rule-soft">
              <DataRow label="Identifier" value={change.resource_id} />
              <DataRow label="Type" value={change.resource_type} mono={false} />
              <DataRow label="Region" value={change.region} />
              <DataRow label="AWS event" value={change.event_name} />
              {change.error_code && <DataRow label="Error" value={change.error_code} />}
            </dl>
          </CollapsibleGroup>

          <Group title="Potential relevance">
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              {formatOffset(change.minutes_from_incident)
                .replace(/^(\d+|<1)/, (m) => `Occurred ${m}`)}
              {prod && ', affecting a production resource'}.
            </p>

            {change.reasons?.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {change.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug text-ink-2">
                    <span aria-hidden="true"
                          className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${s.dot}`} />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </Group>

          {change.signals && (
            <Group title="Relevance score">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[22px] leading-none text-ink tnum">
                  {change.score}
                </span>
                <span className="text-[12px] text-ink-3">of 100</span>
              </div>

              <div className="mt-4 space-y-2">
                {Object.entries(change.signals).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-[136px] shrink-0 text-[12px] text-ink-2">
                      {SIGNAL_LABELS[key] || key.replace(/_/g, ' ')}
                    </span>
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
                      <div
                        className={`h-full rounded-full ${value > 0 ? s.rule : ''}`}
                        style={{ width: `${Math.min(100, (value / 50) * 100)}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right font-mono text-[12px] text-ink tnum">
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                Every point traces to a rule. No part of this score is model output.
              </p>
            </Group>
          )}

          <CollapsibleGroup title="Origin">
            <dl className="divide-y divide-rule-soft">
              <DataRow label="Principal" value={change.actor} />
              <DataRow label="Identity" value={change.actor_type} mono={false} />
              <DataRow label="Source IP" value={change.source_ip} />
              <DataRow label="User agent" value={change.user_agent} />
              <DataRow label="Timestamp" value={formatFull(change.event_time)} />
            </dl>
          </CollapsibleGroup>
        </div>
      </aside>
    </div>
  )
}

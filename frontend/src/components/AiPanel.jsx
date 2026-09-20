import { useEffect, useState } from 'react'
import { Check, Info, ChevronDown, X } from 'lucide-react'
import { Section, ServiceIcon } from './primitives'
import { evidenceFrom, serviceLabel } from '../lib/format'

/**
 * Investigation insight.
 *
 * Deliberately NOT a chat surface: no bubbles, no avatar, no transcript. It is
 * a short written assessment with its provenance stated on the same line, the
 * way a colleague's note in an incident channel would read.
 *
 * Two things stay rigorous:
 *   - Provenance is explicit. When Bedrock is unreachable the panel says the
 *     text is rule-derived rather than passing it off as model output.
 *   - The correlation boundary is stated, not implied.
 */

function ProvenanceLine({ aiOn, modelId }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
      <span className={`h-1.5 w-1.5 rounded-full ${aiOn ? 'bg-accent' : 'bg-ink-3/50'}`}
            aria-hidden="true" />
      {aiOn ? 'Amazon Bedrock' : 'Rule-based analysis'}
      {aiOn && modelId && (
        <span className="hidden font-mono text-ink-3/80 xl:inline">
          · {modelId.split('.').pop().split('-v')[0]}
        </span>
      )}
    </span>
  )
}

/**
 * Explains why the assessment below is rule-derived.
 *
 * Two different situations, deliberately treated differently:
 *
 *   error           — something is genuinely wrong (denied, bad model id, bad
 *                     response). Always shown, never dismissible: hiding a
 *                     fault would be hiding information the operator needs.
 *
 *   not_configured  — nothing is broken; Bedrock simply has no credentials yet.
 *                     This is the expected state for a fresh clone, so it
 *                     collapses to one quiet line and can be dismissed. The
 *                     "Rule-based analysis" badge in the section header states
 *                     provenance either way, so dismissing this never leaves
 *                     the reader thinking they are looking at model output.
 */
function ProvenanceNote({ status, message }) {
  const [dismissed, setDismissed] = useState(false)

  if (!message) return null
  const isFault = status === 'error'

  if (isFault) {
    /* Lead with what the reader has, not with what the system lacks.
       The assessment below is complete either way — Bedrock only rewords
       findings the deterministic engine already produced — so an amber
       failure banner overstates the problem and makes a working result look
       broken. The operator detail is still here in full, one click away,
       because hiding a fault from whoever has to fix it would be worse. */
    return (
      <details className="group mb-4 rounded-control border border-rule bg-sunken/55">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5
                            text-[12px] leading-relaxed text-ink-2">
          <Info size={13} strokeWidth={1.75} aria-hidden="true"
                className="mt-[3px] shrink-0 text-ink-3" />
          <span className="flex-1">
            <span className="font-medium text-ink">
              This assessment is rule-derived and complete.
            </span>{' '}
            Model explanations are unavailable for this account.
          </span>
          <span className="shrink-0 pt-px text-[11.5px] text-ink-3
                           group-open:hidden">Details</span>
        </summary>
        <p className="border-t border-rule-soft px-3 py-2.5 pl-[30px] text-[11.5px]
                      leading-relaxed text-ink-3">
          {message}
        </p>
      </details>
    )
  }

  if (dismissed) return null

  return (
    <div className="mb-4 flex items-start gap-2 rounded-control bg-sunken/55 px-2.5 py-2">
      <Info size={13} strokeWidth={1.75} aria-hidden="true"
            className="mt-[3px] shrink-0 text-ink-3" />
      <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-3">
        <span className="text-ink-2">{message}</span>
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss Bedrock configuration notice"
        className="shrink-0 rounded-control p-1 text-ink-3 transition-colors
                   duration-150 cursor-pointer hover:bg-sunken hover:text-ink"
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}

export function InvestigationInsight({ explanation, changes }) {
  const aiOn = explanation.ai_available
  const byId = new Map(changes.map((c) => [c.event_id, c]))
  const lead = changes[0]
  const evidence = evidenceFrom(lead)

  return (
    <Section
      id="insight"
      title="Investigation insight"
      action={<ProvenanceLine aiOn={aiOn} modelId={explanation.model_id} />}
    >
      {!aiOn && (
        <ProvenanceNote status={explanation.ai_status} message={explanation.ai_error} />
      )}

      <p className="max-w-[68ch] text-[14px] leading-[1.65] text-ink">
        {explanation.summary}
      </p>

      {/* The claim boundary, stated plainly rather than buried in a footnote. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-accent-ink">
          <span className="h-1 w-1 rounded-full bg-accent" aria-hidden="true" />
          Potentially related
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3">
          <span className="h-1 w-1 rounded-full bg-ink-3/50" aria-hidden="true" />
          Not proven causal
        </span>
      </div>

      {evidence.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            Evidence
          </h3>
          <ul className="mt-2.5 space-y-1.5">
            {evidence.map((e) => (
              <li key={e} className="flex items-center gap-2.5 text-[13px] text-ink-2">
                <Check size={13} strokeWidth={2.25} aria-hidden="true"
                       className="shrink-0 text-positive" />
                {e}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
            Derived from the ranking rules applied to{' '}
            <span className="font-mono">{lead?.resource_id}</span>.
          </p>
        </div>
      )}

      {explanation.per_change?.length > 0 && (
        <div className="mt-6 divide-y divide-rule-soft border-t border-rule">
          {explanation.per_change.slice(0, 4).map((item, i) => {
            const change = byId.get(item.event_id)
            return (
              <article key={item.event_id || i} className="py-3.5">
                <h4 className="text-[13px] font-medium leading-snug text-ink">
                  {item.what_changed}
                </h4>
                {change && (
                  <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    <ServiceIcon service={change.aws_service} size={11} />
                    {serviceLabel(change.aws_service)}
                    <span aria-hidden="true">·</span>
                    <span className="truncate font-mono">{change.resource_id}</span>
                  </p>
                )}
                {item.why_it_may_matter && (
                  <p className="mt-2 max-w-[66ch] text-[12.5px] leading-relaxed text-ink-2">
                    {item.why_it_may_matter}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </Section>
  )
}

/**
 * Recommended investigation. Numbered because these genuinely are a sequence:
 * work down the list. Ticking is local and ephemeral — it holds an engineer's
 * place during an incident, it is not persisted state.
 */
export function RecommendedActions({ checks, resetKey }) {
  const [done, setDone] = useState(() => new Set())
  const [open, setOpen] = useState(null)

  useEffect(() => { setDone(new Set()); setOpen(null) }, [resetKey])

  if (!checks?.length) return null

  const toggle = (i) => setDone((prev) => {
    const next = new Set(prev)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })

  return (
    <Section
      id="actions"
      title="Recommended investigation"
      action={`${done.size} of ${checks.length} complete`}
    >
      <ol className="overflow-hidden rounded-card border border-rule bg-surface shadow-subtle">
        {checks.map((check, i) => {
          const checked = done.has(i)
          const expanded = open === i
          return (
            <li key={i} className={i === checks.length - 1 ? '' : 'border-b border-rule-soft'}>
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-pressed={checked}
                  aria-label={`Mark step ${i + 1} ${checked ? 'incomplete' : 'complete'}`}
                  className="flex w-[52px] shrink-0 items-center justify-center border-r
                             border-rule-soft transition-colors duration-150 cursor-pointer
                             hover:bg-sunken/60"
                >
                  {checked ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full
                                     bg-positive">
                      <Check size={12} strokeWidth={3} aria-hidden="true" className="text-white" />
                    </span>
                  ) : (
                    <span className="font-mono text-[12px] text-ink-3 tnum">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : i)}
                  aria-expanded={expanded}
                  className="flex flex-1 items-center gap-3 px-4 py-3 text-left
                             transition-colors duration-150 cursor-pointer hover:bg-sunken/45"
                >
                  <span className={`flex-1 text-[13px] leading-relaxed transition-colors
                                    duration-150 ${
                    checked ? 'text-ink-3 line-through decoration-ink-3/40' : 'text-ink'
                  }`}>
                    {check}
                  </span>
                  <ChevronDown
                    size={14} strokeWidth={1.75} aria-hidden="true"
                    className={`shrink-0 text-ink-3 transition-transform duration-200
                                ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              {expanded && (
                <div className="lift border-t border-rule-soft bg-sunken/35 px-4 py-3 pl-[68px]">
                  <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-2">
                    {checked
                      ? 'Marked complete for this investigation. Ticks reset when you run a new one.'
                      : 'Confirm this against your metrics and logs before drawing a conclusion. ' +
                        'The ranking reflects timing and resource sensitivity, not proven causation.'}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

export default function AiPanel({ explanation, changes, resetKey }) {
  if (!explanation) return null
  return (
    <div className="space-y-10">
      <InvestigationInsight explanation={explanation} changes={changes} />
      <RecommendedActions checks={explanation.recommended_checks} resetKey={resetKey} />
    </div>
  )
}

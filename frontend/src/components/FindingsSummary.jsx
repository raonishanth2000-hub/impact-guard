import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Section, Tag, RelevanceBadge } from './primitives'
import { buildTopology } from '../lib/topology'
import { formatClock12 } from '../lib/format'

/**
 * The four questions, answered on the page where the investigation finishes.
 *
 * WHY THIS EXISTS
 * The result page used to end at the counts — "3 potentially relevant, 11
 * changes detected" — and the only way onward was a small "Topology" link.
 * A reader learned how much had happened but none of what happened, and had
 * to already know that the answers lived behind five sidebar entries.
 *
 * This answers each question in one line, in the order a person actually asks
 * them, and links to the view that carries the full detail. It adds no new
 * data: every value here is already in the investigation payload, and every
 * style is an existing primitive. It is a table of contents with the answers
 * filled in, not a new screen.
 */

function Answer({ index, question, to, linkLabel, children }) {
  return (
    <li className="border-t border-rule-soft py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-baseline gap-2.5 text-[13px] font-semibold text-ink">
          <span className="font-mono text-[11px] text-ink-3 tnum" aria-hidden="true">
            {String(index).padStart(2, '0')}
          </span>
          {question}
        </h3>
        <Link
          to={to}
          className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-accent-ink
                     transition-colors duration-150 hover:text-ink
                     focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-accent-ink"
        >
          {linkLabel}
          <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
      <div className="mt-2 pl-[26px]">{children}</div>
    </li>
  )
}

export default function FindingsSummary({ result }) {
  const changes = result.changes ?? []
  const lead = changes.find((c) => c.occurred_before_incident) ?? changes[0]

  // An empty window is a real answer, not a blank screen. This previously
  // rendered nothing at all, so a reader who switched to Live AWS and happened
  // to pick a quiet window saw four zeroes and no explanation — which reads as
  // broken rather than as "nothing changed here".
  if (!lead) {
    const live = result.data_source === 'aws'
    const minutes = result.incident?.lookback_minutes
    return (
      <Section title="What this means">
        <div className="rounded-card border border-rule bg-surface px-5 py-6 shadow-subtle">
          <h3 className="text-[14px] font-semibold text-ink">
            No changes were recorded in this window
          </h3>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
            {live
              ? `CloudTrail returned no control-plane changes in the ${minutes} minutes
                 before this time. That is a finding in itself: whatever caused the
                 incident, it was probably not a change made in this window.`
              : `The sample data has no changes in the ${minutes} minutes before this
                 time.`}
          </p>
          <ul className="mt-4 space-y-2">
            {[
              `Widen the lookback window — a change ${minutes} minutes out would be missed.`,
              'Check the incident time is right, and in the timezone you expect.',
              live
                ? 'Confirm the region matches where the change was made — CloudTrail is per-region.'
                : 'Switch the source to Live AWS to read your own account instead.',
            ].map((hint) => (
              <li key={hint} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                <span aria-hidden="true"
                      className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-accent" />
                {hint}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    )
  }

  // Edges come from payload evidence in lib/topology.js — a resource named in
  // another's payload, or a security rule opening a known database port at a
  // matching engine. Nothing is assumed.
  //
  // Direction is not meaningful for "what else is involved": a security group
  // rule is recorded as group -> database, so the changed database is the
  // TARGET of its own dependency. Filtering on source alone reported "no
  // dependency" while the topology view showed several.
  const { edges } = buildTopology(changes)
  const related = edges
    .filter((e) => e.source === lead.resource_id || e.target === lead.resource_id)
    .map((e) => ({
      id: e.source === lead.resource_id ? e.target : e.source,
      evidence: e.evidence?.label ?? 'related',
    }))
  const seen = new Set()
  const connected = related.filter((r) => !seen.has(r.id) && seen.add(r.id))

  const services = [...new Set(changes
    .filter((c) => c.relevance === 'HIGH')
    .map((c) => c.aws_service)
    .filter(Boolean))]

  const reasons = (lead.reasons ?? []).slice(0, 3)
  const checks = (result.explanation?.recommended_checks ?? []).slice(0, 3)

  return (
    <Section title="What this means">
      <ol className="rounded-card border border-rule bg-surface px-5 py-4 shadow-subtle">
        <Answer index={1} question="What changed?" to="/changes" linkLabel="All changes">
          <p className="text-[13.5px] leading-relaxed text-ink">
            {lead.narrative?.plain || lead.action_summary}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <RelevanceBadge relevance={lead.relevance} />
            <span className="font-mono text-[11.5px] text-ink-2">{lead.resource_id}</span>
          </div>

          {/* Who, when and which service. Every value comes from the event; a
              field that is absent is omitted rather than filled in. */}
          <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px]">
            {lead.aws_service && (
              <div className="flex gap-1.5">
                <dt className="text-ink-3">Service</dt>
                <dd className="text-ink-2">{lead.aws_service}</dd>
              </div>
            )}
            {lead.actor && (
              <div className="flex gap-1.5">
                <dt className="text-ink-3">Made by</dt>
                <dd className="font-mono text-ink-2">{lead.actor}</dd>
              </div>
            )}
            {lead.event_time && (
              <div className="flex gap-1.5">
                <dt className="text-ink-3">When</dt>
                <dd className="font-mono text-ink-2 tnum">
                  {formatClock12(lead.event_time)}
                </dd>
              </div>
            )}
          </dl>
        </Answer>

        <Answer index={2} question="What could it affect?" to="/graph" linkLabel="Topology">
          {connected.length > 0 ? (
            <>
              <p className="text-[13.5px] leading-relaxed text-ink">
                {connected.length} other resource{connected.length === 1 ? '' : 's'}{' '}
                {connected.length === 1 ? 'is' : 'are'} linked to this one in these
                events, so {connected.length === 1 ? 'it is' : 'they are'} potentially
                affected.
              </p>
              {/* The chain, read the way the brief asks: changed resource first,
                  then what it connects to, with the evidence for each link. */}
              <ol className="mt-2.5 space-y-1.5">
                <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Tag tone="accent">{lead.resource_id}</Tag>
                  <span className="text-[11.5px] text-ink-3">changed</span>
                </li>
                {connected.slice(0, 4).map((c) => (
                  <li key={c.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-3">
                    <span aria-hidden="true" className="text-ink-3">↳</span>
                    <Tag>{c.id}</Tag>
                    <span className="text-[11.5px] text-ink-3">{c.evidence}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              No dependency was recorded in these events, so nothing downstream can be
              shown. {services.length > 0 && (
                <>The changes touch {services.join(', ')}.</>
              )}
            </p>
          )}
        </Answer>

        <Answer index={3} question="Why does it matter?" to="/insight" linkLabel="Insight">
          {reasons.length > 0 ? (
            <ul className="space-y-1.5">
              {reasons.map((r) => (
                <li key={r} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                  <span aria-hidden="true"
                        className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-accent" />
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-2">No scoring signals fired for this change.</p>
          )}
        </Answer>

        <Answer index={4} question="What should I validate?" to="/actions" linkLabel="Actions">
          {checks.length > 0 ? (
            <ol className="space-y-1.5">
              {checks.map((c, i) => (
                <li key={c} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                  <span className="mt-[1px] font-mono text-[11px] text-ink-3 tnum"
                        aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {c}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-ink-2">No checks were derived for this window.</p>
          )}
        </Answer>
      </ol>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        Ranked by timing and resource sensitivity. Nothing here establishes that a change
        caused the incident — it establishes where to look first.
      </p>
    </Section>
  )
}

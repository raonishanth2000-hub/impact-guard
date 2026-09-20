import { useState } from 'react'
import {
  Check, CircleHelp, ArrowRight, Copy, ClipboardCheck, TriangleAlert, User,
} from 'lucide-react'
import { Section, Button } from '../components/primitives'
import { useInvestigation } from '../state/InvestigationContext'
import PageFrame from './PageFrame'
import { formatClock12, formatDate } from '../lib/format'

/**
 * Briefing — the investigation written for someone who does not work in the
 * console.
 *
 * Deliberately organised as certain / uncertain / next, because the failure
 * mode when an engineer updates a manager mid-incident is overstating what is
 * known. Separating the three makes the boundary impossible to blur, and makes
 * the update safe to forward verbatim.
 */

function Copyable({ text }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={copy}>
      {copied
        ? <ClipboardCheck size={13} strokeWidth={1.75} aria-hidden="true" className="text-positive-ink" />
        : <Copy size={13} strokeWidth={1.75} aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy update'}
    </Button>
  )
}

export default function BriefingPage() {
  const { result } = useInvestigation()
  const b = result.briefing
  const lead = result.changes.find((c) => c.occurred_before_incident)

  // A plain-text version of exactly what is on screen, for pasting into chat.
  const plainText = [
    b.headline,
    '',
    'What we know:',
    ...b.certain.map((c) => `- ${c}`),
    '',
    'What we do not know:',
    ...b.uncertain.map((c) => `- ${c}`),
    '',
    'Next steps:',
    ...b.next.map((c, i) => `${i + 1}. ${c}`),
  ].join('\n')

  return (
    <PageFrame
      current="/briefing"
      title="Briefing"
      lede="The same investigation, written for someone who does not work in the console. Safe to forward as it stands."
    >
      <div className="space-y-8">
        {/* Headline */}
        <section className="rounded-card border border-rule bg-surface p-6 shadow-subtle">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-3">
                Situation
              </div>
              <p className="mt-2.5 max-w-[68ch] text-[15px] leading-relaxed text-ink">
                {b.headline}
              </p>
              <p className="mt-3 text-[12.5px] text-ink-2">
                <span className="font-mono tnum">{formatClock12(result.incident.time)}</span>
                {' · '}{formatDate(result.incident.time)}
                {' · '}looking back {result.incident.lookback_minutes} minutes
              </p>
            </div>
            <Copyable text={plainText} />
          </div>

          <div className="mt-5 inline-flex items-center gap-2 rounded-control bg-sunken px-3 py-1.5">
            <CircleHelp size={13} strokeWidth={1.75} aria-hidden="true" className="text-ink-3" />
            <span className="text-[12.5px] text-ink-2">{b.confidence}</span>
          </div>
        </section>

        {/* Certain vs uncertain, side by side so the boundary is visible */}
        <div className="grid gap-5 md:grid-cols-2">
          <Section title="What we know">
            <ul className="space-y-2.5">
              {b.certain.map((c, i) => (
                <li key={i} className="flex gap-2.5">
                  <Check size={14} strokeWidth={2.25} aria-hidden="true"
                         className="mt-0.5 shrink-0 text-positive-ink" />
                  <span className="text-[13px] leading-relaxed text-ink-2">{c}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="What we do not know">
            <ul className="space-y-2.5">
              {b.uncertain.map((c, i) => (
                <li key={i} className="flex gap-2.5">
                  <CircleHelp size={14} strokeWidth={1.75} aria-hidden="true"
                              className="mt-0.5 shrink-0 text-warning-ink" />
                  <span className="text-[13px] leading-relaxed text-ink-2">{c}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {/* The one change that matters, in plain language */}
        {lead?.narrative && (
          <Section title="The change worth looking at first">
            <div className="rounded-card border border-rule bg-surface p-5 shadow-subtle">
              <p className="text-[14px] leading-relaxed text-ink">{lead.narrative.plain}</p>

              <p className="mt-2.5 flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
                <User size={13} strokeWidth={1.75} aria-hidden="true"
                      className="mt-0.5 shrink-0 text-ink-3" />
                {lead.narrative.actor_plain}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
                <div className="rounded-control bg-sunken/60 p-3.5">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
                    Before
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
                    {lead.narrative.before}
                  </p>
                </div>
                <div className="flex items-center justify-center">
                  <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true"
                              className="text-accent-ink sm:rotate-0 rotate-90" />
                </div>
                <div className="rounded-control bg-accent-wash p-3.5">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-accent-ink">
                    After
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">
                    {lead.narrative.after}
                  </p>
                </div>
              </div>

              {!lead.narrative.before_known && (
                <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                  The exact previous values are not recoverable from the change log — it
                  records what was requested, not what the setting had been.
                </p>
              )}
            </div>
          </Section>
        )}

        {/* Risk and validation, from the same change */}
        {lead?.narrative && (
          <div className="grid gap-5 md:grid-cols-2">
            <Section title="What could go wrong">
              <ul className="space-y-2.5">
                {lead.narrative.risks.map((r, i) => (
                  <li key={i} className="flex gap-2.5">
                    <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true"
                                   className="mt-0.5 shrink-0 text-warning-ink" />
                    <span className="text-[13px] leading-relaxed text-ink-2">{r}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Recommended checks">
              <p className="mb-3 text-[12px] leading-relaxed text-ink-3">
                What to verify about this change, and what to confirm before a similar
                one is made again.
              </p>
              <ol className="space-y-2.5">
                {lead.narrative.checklist.map((c, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-[2px] w-4 shrink-0 font-mono text-[11px] text-ink-3 tnum">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[13px] leading-relaxed text-ink-2">{c}</span>
                  </li>
                ))}
              </ol>
            </Section>
          </div>
        )}

        {/* Next steps */}
        <Section title="Recommended next steps">
          <ol className="overflow-hidden rounded-card border border-rule bg-surface shadow-subtle">
            {b.next.map((s, i) => (
              <li key={i} className={`flex gap-4 px-4 py-3.5 ${
                i === b.next.length - 1 ? '' : 'border-b border-rule-soft'}`}>
                <span className="font-mono text-[12px] text-accent-ink tnum">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[13.5px] leading-relaxed text-ink">{s}</span>
              </li>
            ))}
          </ol>
        </Section>

        <p className="text-[11.5px] leading-relaxed text-ink-3">
          Everything above is derived from recorded changes and their timing. None of it
          establishes cause — it establishes where to look.
        </p>
      </div>
    </PageFrame>
  )
}

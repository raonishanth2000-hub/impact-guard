import { isProduction, formatClock12, formatDate } from '../lib/format'
import { Tag } from './primitives'

/**
 * Incident header. The page title and the first thing read.
 *
 * Built from type and spacing rather than a coloured panel. The only chromatic
 * element is a small status pill, because the severity is already carried by
 * the counts below it.
 */
export default function IncidentBanner({ incident, stats, changes, dataSource }) {
  const highBefore = changes.filter(
    (c) => c.relevance === 'HIGH' && c.occurred_before_incident,
  )
  const touchesProd = changes.some((c) => isProduction(c.resource_id))

  const status = highBefore.length > 0
    ? { label: 'Investigating', tone: 'accent' }
    : stats.medium > 0
      ? { label: 'Reviewing', tone: 'neutral' }
      : { label: 'No candidates', tone: 'neutral' }

  const metrics = [
    { label: 'Potentially relevant', value: stats.high, emphasis: stats.high > 0 },
    { label: 'Changes detected', value: stats.total },
    { label: 'Before incident', value: stats.before_incident },
    { label: 'Investigation window', value: `${incident.lookback_minutes} min`, mono: false },
  ]

  return (
    <section id="investigation" className="scroll-mt-24">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          {/* No eyebrow here: PageFrame already renders one above this. */}
          <h2 className="max-w-[22ch] text-[30px] font-semibold leading-[1.15]
                         tracking-[-0.02em] text-ink sm:text-[34px]">
            {incident.description || 'Incident reported'}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-2">
            <time dateTime={incident.time} className="font-mono tnum text-ink">
              {formatClock12(incident.time)}
            </time>
            <span className="text-rule" aria-hidden="true">|</span>
            <span>{formatDate(incident.time)}</span>
            {touchesProd && (
              <>
                <span className="text-rule" aria-hidden="true">|</span>
                <Tag>Production</Tag>
              </>
            )}
            <Tag tone={status.tone}>{status.label}</Tag>
          </div>
        </div>
      </div>

      {/* Summary metrics: a flat row of figures, not four cards. */}
      <dl className="mt-7 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-rule py-5
                     sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label}>
            <dd className={`font-mono text-[22px] leading-none tnum ${
              m.emphasis ? 'text-accent-ink' : 'text-ink'
            }`}>
              {m.value}
            </dd>
            <dt className="mt-2 text-[12px] text-ink-2">{m.label}</dt>
          </div>
        ))}
      </dl>

      <p className="mt-3 max-w-[70ch] text-[12px] leading-relaxed text-ink-3">
        {dataSource === 'demo'
          ? 'Sample events — no AWS account required.'
          : <>
              Live CloudTrail management events, read from the account this API is
              deployed in. To run it against your own account, clone the repo and
              start it locally with your credentials — see{' '}
              <a
                href="https://github.com/raonishanth2000-hub/impact-guard#run-it-on-your-own-aws-account"
                target="_blank" rel="noreferrer"
                className="text-accent-ink underline underline-offset-2
                           hover:text-ink focus-visible:outline-2
                           focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
              >
                Run it on your own AWS account
              </a>.
            </>}
      </p>
    </section>
  )
}

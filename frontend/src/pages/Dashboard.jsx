import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, Play,
  CircleCheck, CircleAlert, Server,
} from 'lucide-react'
import { Button, Card, Mark, Tag } from '../components/primitives'
import { useInvestigation } from '../state/InvestigationContext'
import { formatClock12, formatDate, serviceLabel } from '../lib/format'

/**
 * Dashboard — the landing surface.
 *
 * Answers three questions before the engineer commits to anything: is the
 * system ready, what did the last run find, and where do I go next. It reports
 * only state the app actually knows; nothing here is invented.
 */

function StatusRow({ ok, label, detail }) {
  const Icon = ok ? CircleCheck : CircleAlert
  return (
    <div className="flex items-start gap-2.5 py-2.5">
      <Icon size={15} strokeWidth={1.75} aria-hidden="true"
            className={`mt-0.5 shrink-0 ${ok ? 'text-positive-ink' : 'text-warning-ink'}`} />
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{label}</div>
        <div className="text-[11.5px] leading-relaxed text-ink-3">{detail}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { result, health, loading, loadDemo, mode } = useInvestigation()
  const navigate = useNavigate()

  const cfg = health?.config || {}
  const hasResult = !!result
  const stats = result?.stats

  const startDemo = async () => {
    const data = await loadDemo()
    if (data) navigate('/investigation')
  }

  return (
    <div className="space-y-10">
      {/* Masthead */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="text-accent-ink"><Mark size={22} /></span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                Impact Guard
              </span>
            </div>
            <h1 className="mt-3 max-w-[20ch] text-[30px] font-semibold leading-[1.15]
                           tracking-[-0.02em] text-ink sm:text-[34px]">
              Find what changed before you start debugging.
            </h1>
            <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-ink-2">
              Give Impact Guard the moment an incident began. It collects AWS
              control-plane changes from around that time, ranks them by how plausibly
              they relate, and tells you what to check first.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 sm:shrink-0">
            <Button variant="secondary" onClick={startDemo} disabled={loading}>
              <Play size={14} strokeWidth={1.75} aria-hidden="true" />
              {loading ? 'Loading' : 'Load demo'}
            </Button>
            <Button variant="primary" onClick={() => navigate('/investigation')}>
              Start investigation
              <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>

      {/* Last run */}
      <section>
        <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-2.5">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {hasResult ? 'Most recent investigation' : 'No investigation yet'}
          </h2>
          {hasResult && (
            <Link to="/investigation"
                  className="shrink-0 text-[12px] text-accent-ink hover:underline">
              Open
            </Link>
          )}
        </div>

        {hasResult ? (
          <div className="pt-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="text-[16px] font-medium text-ink">
                {result.incident.description || 'Incident reported'}
              </h3>
              <Tag tone={stats.high > 0 ? 'accent' : 'neutral'}>
                {stats.high > 0 ? 'Investigating' : 'Reviewed'}
              </Tag>
            </div>
            <p className="mt-1.5 text-[12.5px] text-ink-2">
              <span className="font-mono tnum">{formatClock12(result.incident.time)}</span>
              {' · '}{formatDate(result.incident.time)}
              {' · '}{result.incident.lookback_minutes} minute window
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-rule py-5
                           sm:grid-cols-4">
              {[
                { label: 'Potentially relevant', value: stats.high, hot: stats.high > 0 },
                { label: 'Worth reviewing', value: stats.medium },
                { label: 'Changes detected', value: stats.total },
                { label: 'Before incident', value: stats.before_incident },
              ].map((m) => (
                <div key={m.label}>
                  <dd className={`font-mono text-[22px] leading-none tnum ${
                    m.hot ? 'text-accent-ink' : 'text-ink'
                  }`}>{m.value}</dd>
                  <dt className="mt-2 text-[12px] text-ink-2">{m.label}</dt>
                </div>
              ))}
            </dl>

            {/* Top candidate, so the dashboard answers "what matters" directly. */}
            {result.changes?.[0] && (
              <Link
                to="/changes"
                className="mt-5 flex items-center gap-4 rounded-card border border-rule
                           bg-surface px-4 py-3.5 shadow-subtle transition-colors
                           duration-150 hover:bg-sunken/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">
                    Highest-ranked change
                  </div>
                  <div className="mt-1 truncate text-[13.5px] font-medium text-ink">
                    {result.changes[0].action_summary}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-2">
                    {serviceLabel(result.changes[0].aws_service)}
                    {' · '}
                    <span className="font-mono">{result.changes[0].actor}</span>
                  </div>
                </div>
                <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true"
                            className="shrink-0 text-ink-3" />
              </Link>
            )}
          </div>
        ) : (
          <div className="pt-4">
            <p className="max-w-[58ch] text-[13.5px] leading-relaxed text-ink-2">
              Nothing has been analysed in this session. Load the demo incident to see a
              complete investigation, or start your own from the investigation page.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" onClick={startDemo} disabled={loading}>
                <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                {loading ? 'Loading demo' : 'Load demo investigation'}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/investigation')}>
                Set an incident time
              </Button>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-10">
        {/* System status */}
        <section>
          <div className="border-b border-rule pb-2.5">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              System status
            </h2>
          </div>
          <Card className="mt-4 divide-y divide-rule-soft px-4 py-1">
            <StatusRow
              ok={!!health}
              label={health ? 'API connected' : 'API unreachable'}
              detail={health ? `Region ${cfg.aws_region || 'unknown'}` : 'Start the backend to investigate'}
            />
            <StatusRow
              ok={(result?.data_source ?? mode) === 'aws'}
              label={(result?.data_source ?? mode) === 'aws' ? 'Live CloudTrail' : 'Demo data source'}
              detail={(result?.data_source ?? mode) === 'aws'
                ? 'Reading real management events'
                : 'Generated sample events, no AWS account needed'}
            />
            <StatusRow
              ok={!!result?.explanation?.ai_available}
              label={result?.explanation?.ai_available ? 'Bedrock explanations on' : 'Rule-based explanations'}
              detail={result?.explanation?.ai_available
                ? cfg.bedrock_model_id
                : 'Deterministic scoring engine — complete without a model'}
            />
            <StatusRow
              ok
              label={`${health?.supported_events?.length ?? 0} event types supported`}
              detail="Extend the catalog to cover more AWS services"
            />
          </Card>

          {health?.supported_events?.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-1.5 text-[11px] font-medium
                              uppercase tracking-[0.07em] text-ink-3">
                <Server size={12} strokeWidth={1.75} aria-hidden="true" />
                Tracked events
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {health.supported_events.slice(0, 11).map((e) => (
                  <span key={e}
                        className="rounded-control bg-sunken px-1.5 py-1 font-mono
                                   text-[10.5px] text-ink-2">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

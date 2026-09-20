import ControlBar from '../components/ControlBar'
import IncidentBanner from '../components/IncidentBanner'
import { Button } from '../components/primitives'
import { useInvestigation } from '../state/InvestigationContext'
import { toLocalInputValue, formatClock12 } from '../lib/format'
import PageFrame from './PageFrame'
import { CircleAlert, RotateCw, Clock } from 'lucide-react'

/** Skeleton mirrors the real layout so nothing jumps when the result lands. */
function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Running investigation">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton mt-4 h-9 w-[420px] max-w-full" />
      <div className="skeleton mt-3 h-4 w-64" />
      <div className="mt-7 grid grid-cols-2 gap-8 border-y border-rule py-5 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i}>
            <div className="skeleton h-6 w-12" />
            <div className="skeleton mt-2.5 h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="rounded-card border border-rule bg-surface p-6 shadow-subtle">
      <div className="flex items-start gap-3">
        <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true"
                     className="mt-0.5 shrink-0 text-severe" />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Investigation unavailable</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{error.message}</p>
          {error.detail && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{error.detail}</p>
          )}
          {error.code === 'network' && (
            <code className="mt-3 inline-block rounded-control bg-sunken px-2.5 py-1.5
                             font-mono text-[11.5px] text-ink-2">
              cd backend &amp;&amp; python3 local_server.py
            </code>
          )}
          <div className="mt-5">
            <Button onClick={onRetry} variant="secondary">
              <RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}


/**
 * Warns when the incident time looks too early.
 *
 * If most changes in the window happened *after* the stated incident time, the
 * engine correctly refuses to rank any of them as contributing causes — and the
 * result reads as "nothing relevant found", which is indistinguishable from a
 * genuinely quiet window. That is a confusing failure, and it is usually caused
 * by a timestamp that is a minute or two early rather than by a real absence.
 *
 * So: detect it, explain it, and offer the corrected time in one click.
 */
function IncidentTimeHint({ result, onUseTime }) {
  const { changes, stats } = result
  if (!changes?.length || stats.total === 0) return null

  const after = changes.filter((c) => !c.occurred_before_incident)
  // Only worth raising when the majority landed after, and nothing ranked high.
  if (after.length < Math.ceil(stats.total * 0.5) || stats.high > 0) return null

  const latest = changes.reduce(
    (a, c) => (new Date(c.event_time) > new Date(a.event_time) ? c : a), changes[0])
  // One minute past the last change, so minute-precision entry stays safe.
  const suggested = new Date(new Date(latest.event_time).getTime() + 60000)
  suggested.setSeconds(0, 0)

  return (
    <div className="flex gap-3 rounded-card border border-warning/30 bg-warning-wash p-4">
      <Clock size={16} strokeWidth={1.75} aria-hidden="true"
             className="mt-0.5 shrink-0 text-warning-ink" />
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold text-ink">
          This incident time may be too early
        </h3>
        <p className="mt-1.5 max-w-[68ch] text-[12.5px] leading-relaxed text-ink-2">
          {after.length} of {stats.total} changes happened <em>after</em> the time you
          entered, so none can have contributed to it — which is why nothing is ranked
          as relevant. The last change landed at{' '}
          <span className="font-mono">{formatClock12(latest.event_time)}</span>.
        </p>
        <button
          type="button"
          onClick={() => onUseTime(toLocalInputValue(suggested))}
          className="mt-3 inline-flex items-center gap-1.5 rounded-control bg-surface px-3
                     py-1.5 text-[12.5px] font-medium text-ink ring-1 ring-rule
                     transition-colors duration-150 cursor-pointer hover:bg-sunken"
        >
          Use {formatClock12(suggested.toISOString())} instead
        </button>
      </div>
    </div>
  )
}

/**
 * Investigation — where a run is configured and its summary read. The controls
 * live here rather than in the shell so the other views stay focused on
 * reading, not re-running.
 */
export default function InvestigationPage() {
  const {
    incidentTime, setIncidentTime, lookback, setLookback,
    description, setDescription, mode, setMode,
    result, loading, error, run, loadDemo,
  } = useInvestigation()

  return (
    <div className="space-y-8">
      <ControlBar
        incidentTime={incidentTime} setIncidentTime={setIncidentTime}
        lookback={lookback} setLookback={setLookback}
        description={description} setDescription={setDescription}
        mode={mode} setMode={setMode}
        onInvestigate={() => run()}
        onLoadDemo={loadDemo}
        loading={loading}
      />

      {error && <ErrorState error={error} onRetry={() => run()} />}
      {loading && !result && <Skeleton />}

      {result && !loading && (
        <IncidentTimeHint
          result={result}
          onUseTime={(local) => { setIncidentTime(local); run({ incidentTime: local }) }}
        />
      )}

      {result && !loading && (
        <PageFrame
          current="/investigation"
          title="Incident summary"
          lede="What was reported, when, and how much changed around it."
        >
          <IncidentBanner
            incident={result.incident}
            stats={result.stats}
            changes={result.changes}
            dataSource={result.data_source}
          />
        </PageFrame>
      )}

      {!result && !loading && !error && (
        <div className="py-20 text-center">
          <h2 className="text-[17px] font-semibold text-ink">Set the time it broke</h2>
          <p className="mx-auto mt-2 max-w-[48ch] text-[13.5px] leading-relaxed text-ink-2">
            Enter the moment the incident began and press Investigate, or load the
            demo incident to see a worked example.
          </p>
        </div>
      )}
    </div>
  )
}

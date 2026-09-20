import { Link } from 'react-router-dom'
import { Button } from '../components/primitives'
import { useInvestigation } from '../state/InvestigationContext'

/**
 * Guards the analysis pages. Without a run there is nothing to show, so we
 * explain that and offer the two ways forward rather than rendering an empty
 * page or bouncing the user somewhere unexpected.
 */
export default function RequireResult({ children }) {
  const { result, loading, loadDemo } = useInvestigation()

  if (result) return children

  return (
    <div className="mx-auto max-w-[520px] py-24 text-center">
      <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">
        Nothing to analyse yet
      </h2>
      <p className="mx-auto mt-2.5 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
        This view reads from an investigation. Run one from the investigation page,
        or load the demo incident to see a complete example.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={loadDemo} disabled={loading}>
          {loading ? 'Loading demo' : 'Load demo investigation'}
        </Button>
        <Link to="/investigation">
          <Button variant="secondary">Set an incident time</Button>
        </Link>
      </div>
    </div>
  )
}

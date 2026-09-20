import { RecommendedActions } from '../components/AiPanel'
import { useInvestigation } from '../state/InvestigationContext'
import PageFrame from './PageFrame'

export default function ActionsPage() {
  const { result } = useInvestigation()
  return (
    <PageFrame
      current="/actions"
      title="Recommended investigation"
      lede="Concrete checks derived from the ranked changes. Tick them off as you work; ticks reset when you run a new investigation."
    >
      <RecommendedActions
        checks={result.explanation?.recommended_checks}
        resetKey={result.generated_at}
      />
    </PageFrame>
  )
}

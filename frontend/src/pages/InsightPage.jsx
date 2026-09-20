import { InvestigationInsight } from '../components/AiPanel'
import { useInvestigation } from '../state/InvestigationContext'
import PageFrame from './PageFrame'

export default function InsightPage() {
  const { result } = useInvestigation()
  return (
    <PageFrame
      current="/insight"
      title="Investigation insight"
      lede="A written assessment of the ranked changes, with its provenance stated. Correlation only — never a claim of cause."
    >
      <InvestigationInsight
        explanation={result.explanation}
        changes={result.changes}
      />
    </PageFrame>
  )
}

import ChangeList from '../components/ChangeList'
import { useInvestigation } from '../state/InvestigationContext'
import PageFrame from './PageFrame'

export default function ChangesPage() {
  const { result, selectedId, openDetail } = useInvestigation()
  return (
    <PageFrame
      current="/changes"
      title="Ranked changes"
      lede="Scored by timing, blast radius and resource sensitivity. Every ranking shows the rules behind it."
    >
      <ChangeList
        changes={result.changes}
        selectedId={selectedId}
        onSelect={openDetail}
      />
    </PageFrame>
  )
}

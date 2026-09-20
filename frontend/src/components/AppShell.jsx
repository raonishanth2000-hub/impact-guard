import { useState } from 'react'
import {
  LayoutDashboard, Activity, Share2, Layers, Lightbulb, ListChecks, Presentation, HelpCircle,
} from 'lucide-react'
import {
  Sidebar, SidebarBody, SidebarLink, CollapsibleLabel,
} from '@/components/ui/sidebar'
import { Mark } from './primitives'
import { useInvestigation } from '../state/InvestigationContext'
import { restartTour } from './onboarding/ProductTour'

/**
 * Application shell.
 *
 * The rail collapses to icons and expands on hover (or keyboard focus). Routes
 * that read from an investigation stay visibly disabled until one has run, so
 * a page can never render an empty frame.
 */

const ICON = 'h-5 w-5 shrink-0'

export const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard, end: true, always: true },
  { to: '/investigation', label: 'Investigation', Icon: Activity },
  { to: '/graph', label: 'Topology', Icon: Share2 },
  { to: '/changes', label: 'Changes', Icon: Layers },
  { to: '/insight', label: 'Insight', Icon: Lightbulb },
  { to: '/actions', label: 'Actions', Icon: ListChecks },
  { to: '/briefing', label: 'Briefing', Icon: Presentation },
]

/** Brand lockup. The wordmark fades with the rail; the mark always shows. */
function Brand() {
  return (
    <div className="flex items-center gap-3 px-2.5 py-1">
      <span className="shrink-0 text-accent-ink"><Mark size={24} /></span>
      <CollapsibleLabel>
        <span className="block text-[14px] font-semibold tracking-[-0.01em] text-ink">
          Impact Guard
        </span>
        <span className="block text-[11px] text-ink-3">Change investigation</span>
      </CollapsibleLabel>
    </div>
  )
}

/** Environment status. Collapses to just the health dot on the icon rail. */
function EnvFooter() {
  const { result, health, mode, runCount } = useInvestigation()
  const live = (result?.data_source ?? mode) === 'aws'

  return (
    <div className="mt-auto border-t border-rule px-2.5 pt-3.5">
      {/* Restart the onboarding tour. Sits with the environment status because
          that is where the other "about this session" information lives, and it
          collapses to its icon on the rail like every other row. */}
      <button
        type="button"
        onClick={restartTour}
        title="Take the tour again"
        className="mb-3 flex w-full items-center gap-3 rounded-control py-1.5
                   text-left transition-colors duration-150 cursor-pointer
                   hover:bg-sunken focus-visible:outline-2
                   focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
      >
        <HelpCircle size={14} strokeWidth={1.75} aria-hidden="true"
                    className="shrink-0 text-ink-3" />
        <CollapsibleLabel className="text-[12.5px] text-ink-2">
          Take the tour again
        </CollapsibleLabel>
      </button>

      <div className="flex items-center gap-3">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${health ? 'bg-positive' : 'bg-warning'}`}
          aria-hidden="true"
        />
        <CollapsibleLabel>
          <span className="block text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
            Environment
          </span>
          <span className="block text-[12.5px] text-ink">
            {live ? 'Live CloudTrail' : 'Demo data'}
          </span>
          <span className="block text-[11.5px] text-ink-3">
            {health ? 'API connected' : 'API unreachable'}
            {runCount > 0 && ` · ${runCount} run${runCount === 1 ? '' : 's'}`}
          </span>
        </CollapsibleLabel>
      </div>
      {/* Screen readers get the full status regardless of the visual collapse. */}
      <span className="sr-only">
        {live ? 'Live CloudTrail' : 'Demo data'}. {health ? 'API connected' : 'API unreachable'}.
      </span>
    </div>
  )
}

function Nav({ onNavigate }) {
  const { result } = useInvestigation()
  const hasResult = !!result

  return (
    <nav aria-label="Main" className="mt-7 flex-1">
      <ul className="flex flex-col gap-1.5">
        {NAV.map(({ to, label, Icon, end, always }) => (
          <li key={to}>
            <SidebarLink
              onNavigate={onNavigate}
              link={{
                href: to,
                label,
                end,
                icon: <Icon className={ICON} strokeWidth={1.75} aria-hidden="true" />,
                disabled: !always && !hasResult,
                disabledHint: 'Run an investigation to enable this view',
              }}
            />
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default function AppShell({ children }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-full">
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody>
          <div className="flex h-full flex-col">
            <Brand />
            {/* Closing the overlay on navigate matters on mobile, where the
                sheet covers the page it just routed to. */}
            <Nav onNavigate={() => setOpen(false)} />
            <EnvFooter />
          </div>
        </SidebarBody>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

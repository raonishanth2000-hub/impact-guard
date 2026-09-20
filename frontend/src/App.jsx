import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { InvestigationProvider, useInvestigation } from './state/InvestigationContext'
import AppShell from './components/AppShell'
import ChangeDetail from './components/ChangeDetail'
import Toast from './components/Toast'

import Dashboard from './pages/Dashboard'
import SaasTemplate from '@/components/ui/saas-template'
import InvestigationPage from './pages/InvestigationPage'
import ChangesPage from './pages/ChangesPage'
import InsightPage from './pages/InsightPage'
import ActionsPage from './pages/ActionsPage'
import BriefingPage from './pages/BriefingPage'
import RequireResult from './pages/RequireResult'
import ProductTour from './components/onboarding/ProductTour'

// React Flow is ~200KB. It is only needed on the topology route, so it is split
// out and fetched on demand rather than taxing every other page's first load.
const GraphPage = lazy(() => import('./pages/GraphPage'))

function GraphFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading topology">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-8 w-52" />
      <div className="skeleton h-[460px] w-full rounded-card" />
    </div>
  )
}

/**
 * Routed application.
 *
 * The dashboard is the landing surface; the five investigation views are
 * separate routes sharing one run through InvestigationContext. The change
 * detail panel and the toast mount once at shell level so they work from any
 * page.
 */

function Layout() {
  const { selectedChange, closeDetail, toast, dismissToast } = useInvestigation()

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-9 lg:px-8">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/investigation" element={<InvestigationPage />} />
          <Route path="/graph" element={
            <RequireResult>
              <Suspense fallback={<GraphFallback />}><GraphPage /></Suspense>
            </RequireResult>
          } />
          <Route path="/changes" element={<RequireResult><ChangesPage /></RequireResult>} />
          <Route path="/insight" element={<RequireResult><InsightPage /></RequireResult>} />
          <Route path="/actions" element={<RequireResult><ActionsPage /></RequireResult>} />
          <Route path="/briefing" element={<RequireResult><BriefingPage /></RequireResult>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* First-run onboarding. Self-gating on localStorage; renders nothing
          for a returning visitor. */}
      <ProductTour />

      <ChangeDetail change={selectedChange} onClose={closeDetail} />
      <Toast toast={toast} onDismiss={dismissToast} />

      <footer className="border-t border-rule px-6 py-5 lg:px-8">
        <p className="mx-auto max-w-[1400px] text-[11.5px] text-ink-3">
          An investigation layer over CloudTrail — not a replacement for it.
          Rankings reflect timing correlation and resource sensitivity, not proven causation.
        </p>
      </footer>
    </AppShell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <InvestigationProvider>
        <Routes>
          {/* The landing page sits outside the shell: it has its own surface,
              its own palette, and no sidebar. */}
          <Route path="/" element={<SaasTemplate />} />
          <Route path="/*" element={<Layout />} />
        </Routes>
      </InvestigationProvider>
    </BrowserRouter>
  )
}

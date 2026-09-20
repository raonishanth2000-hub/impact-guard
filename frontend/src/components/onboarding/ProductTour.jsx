import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useInvestigation } from '../../state/InvestigationContext'
import Spotlight from './Spotlight'
import TourStep from './TourStep'

/**
 * First-run product tour.
 *
 * Teaches the mental model the product is built around:
 *
 *     AWS changes -> timeline -> a relevant change -> explanation -> incident
 *
 * Two things shape the implementation.
 *
 * The steps live on DIFFERENT ROUTES — the timeline is on /graph, change
 * detail on /changes, the assessment on /insight — so each step declares the
 * route it needs and the tour navigates there. Those routes are also guarded
 * by RequireResult, so the tour loads the demo investigation first; without it
 * every step after the first would spotlight an empty state.
 *
 * Positioning is measured with getBoundingClientRect on a timer, never on an
 * animation frame. This project's preview environment does not reliably
 * composite, and a tour whose overlay never paints is worse than no tour.
 */

export const TOUR_KEY = 'changeDetectiveTourCompleted'

export const hasSeenTour = () => {
  try { return localStorage.getItem(TOUR_KEY) === 'true' } catch { return true }
}

const markSeen = () => {
  try { localStorage.setItem(TOUR_KEY, 'true') } catch { /* private mode */ }
}

/** Fired by the Help menu to restart the tour from anywhere. */
export const TOUR_RESTART_EVENT = 'impact-guard:restart-tour'
export const restartTour = () => {
  try { localStorage.removeItem(TOUR_KEY) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(TOUR_RESTART_EVENT))
}

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Impact Guard',
    subtitle: 'Find what changed before you start investigating manually.',
    body: 'Impact Guard reads AWS change events, puts them on a timeline, and ranks '
        + 'the ones worth looking at first. This takes about 40 seconds.',
    route: '/dashboard',
  },
  {
    id: 'timeline',
    eyebrow: 'Step 1',
    title: 'See what changed',
    body: 'Recent AWS changes are laid out in order, with the incident marked in place, '
        + 'so you can see what happened in the minutes before it.',
    route: '/graph',
    target: '[data-tour="timeline"]',
  },
  {
    id: 'detail',
    eyebrow: 'Step 2',
    title: 'Understand the change',
    body: 'Open a change to see the resource, the action, when it happened and who made '
        + 'it — plus the request the caller actually sent.',
    route: '/changes',
    target: '[role="dialog"]',
    openFirstChange: true,
  },
  {
    id: 'insight',
    eyebrow: 'Step 3',
    title: 'Read the assessment',
    body: 'Each ranked change comes with the evidence behind it: why it may be related, '
        + 'and what to check next. Nothing here claims a change caused the incident.',
    route: '/insight',
    target: '#insight',
  },
  {
    id: 'incident',
    eyebrow: 'Step 4',
    title: 'Investigate an incident',
    body: 'Give it the moment the problem started and it finds the potentially relevant '
        + 'changes around that time.',
    example: 'Issue started    10:42\n'
           + 'Potentially relevant:\n'
           + '  10:41  RDS modified\n'
           + '  10:39  Lambda deployed\n'
           + '  10:35  Security group changed',
    route: '/investigation',
    target: '[aria-label="Investigation parameters"]',
  },
  {
    id: 'demo',
    title: 'Ready to investigate?',
    body: 'Run a sample incident and follow it through: what changed, what it could '
        + 'affect, why it matters, and what to check.',
    route: '/investigation',
  },
]

export default function ProductTour() {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState(null)

  const navigate = useNavigate()
  const location = useLocation()
  const { result, loadDemo, openDetail, closeDetail } = useInvestigation()
  const timers = useRef([])

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)) }

  useEffect(() => clearTimers, [])

  // --- start conditions ----------------------------------------------------
  useEffect(() => {
    // Only on a first visit, and only inside the console — the landing page is
    // its own thing and a tour over it would have nothing to point at.
    if (!hasSeenTour() && location.pathname.startsWith('/dashboard')) {
      later(() => setOpen(true), 700)
    }
    const onRestart = () => { setIndex(0); setRect(null); setOpen(true) }
    window.addEventListener(TOUR_RESTART_EVENT, onRestart)
    return () => window.removeEventListener(TOUR_RESTART_EVENT, onRestart)
    // Deliberately mount-only: re-running on every navigation would reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const step = STEPS[index]

  // --- drive the app to the state each step describes ----------------------
  useEffect(() => {
    if (!open || !step) return
    clearTimers()
    setRect(null)

    // Steps after the first read from an investigation. Load the demo once so
    // they show real content instead of the "nothing to analyse yet" guard.
    if (index > 0 && !result) loadDemo()

    if (step.route && location.pathname !== step.route) navigate(step.route)

    if (step.openFirstChange && result?.changes?.length) {
      later(() => openDetail(result.changes[0].event_id), 380)
    } else if (!step.openFirstChange) {
      closeDetail()
    }

    // Measure after the route has painted. Retried a few times because the
    // target may mount a beat late (the demo request, a route transition).
    const attempts = [420, 780, 1250, 1900]
    attempts.forEach((ms) => later(() => {
      if (!step.target) { setRect(null); return }
      const el = document.querySelector(step.target)
      if (!el) return                       // keep the centred fallback
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
      const r = el.getBoundingClientRect()
      if (r.width > 8 && r.height > 8) {
        setRect({ top: r.top, left: r.left, right: r.right,
                  bottom: r.bottom, width: r.width, height: r.height })
      }
    }, ms))

    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, result])

  // --- controls ------------------------------------------------------------
  const finish = useCallback(() => {
    markSeen()
    clearTimers()
    closeDetail()
    setOpen(false)
  }, [closeDetail])

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, STEPS.length - 1)), [])
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  const runDemo = useCallback(() => {
    finish()
    navigate('/investigation')
    loadDemo()
  }, [finish, navigate, loadDemo])

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
      else if (e.key === 'Enter' && index === STEPS.length - 1) { e.preventDefault(); runDemo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, index, finish, next, back, runDemo])

  if (!open || !step) return null

  return (
    <>
      <Spotlight rect={rect} />
      <TourStep
        step={step}
        index={index}
        total={STEPS.length}
        rect={rect}
        onNext={next}
        onBack={back}
        onSkip={finish}
        onFinish={finish}
        onDemo={runDemo}
      />
    </>
  )
}

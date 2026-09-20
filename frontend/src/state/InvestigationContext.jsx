import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import * as api from '../api'
import { localInputToISO, toLocalInputValue } from '../lib/format'

/**
 * One investigation, shared by every route.
 *
 * Splitting the product across pages means the result can no longer live in a
 * single screen component — Timeline, Changes, Insight and Actions all read the
 * same run. This holds the form state, the result, and the two actions that
 * produce it. The API contract is untouched.
 */

const DEMO_OFFSET_MINUTES = 6
const DEMO_DESCRIPTION = 'Checkout requests started timing out'

const InvestigationContext = createContext(null)

export function useInvestigation() {
  const ctx = useContext(InvestigationContext)
  if (!ctx) throw new Error('useInvestigation must be used inside InvestigationProvider')
  return ctx
}

export function InvestigationProvider({ children }) {
  const [incidentTime, setIncidentTime] = useState(() =>
    toLocalInputValue(new Date(Date.now() - DEMO_OFFSET_MINUTES * 60000)),
  )
  const [lookback, setLookback] = useState(30)
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState('demo')

  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [health, setHealth] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [toast, setToast] = useState(null)
  // Counts completed runs so the dashboard can show session activity.
  const [runCount, setRunCount] = useState(0)

  useEffect(() => {
    api.getHealth()
      .then((h) => {
        setHealth(h)
        if (h?.config?.data_source) setMode(h.config.data_source)
      })
      .catch(() => setHealth(null))
  }, [])

  const run = useCallback(async (overrides = {}) => {
    const payload = {
      incidentTime: localInputToISO(overrides.incidentTime ?? incidentTime),
      lookbackMinutes: overrides.lookback ?? lookback,
      description: overrides.description ?? description,
      mode: overrides.mode ?? mode,
    }

    if (!payload.incidentTime) {
      setError({ message: 'Enter a valid incident time to begin an investigation.' })
      return null
    }

    setLoading(true)
    setError(null)
    setSelectedId(null)
    try {
      const data = await api.investigate(payload)
      setResult(data)
      setRunCount((n) => n + 1)
      setToast(
        overrides.toast
          ? { message: overrides.toast, tone: 'ok' }
          : {
              message: `${data.stats.total} changes analysed · ${data.stats.high} potentially relevant`,
              tone: data.stats.high > 0 ? 'warn' : 'ok',
            },
      )
      return data
    } catch (err) {
      setError({ message: err.message, detail: err.detail, code: err.code })
      setResult(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [incidentTime, lookback, description, mode])

  const loadDemo = useCallback(() => {
    const when = toLocalInputValue(new Date(Date.now() - DEMO_OFFSET_MINUTES * 60000))
    setIncidentTime(when)
    setDescription(DEMO_DESCRIPTION)
    setLookback(30)
    setMode('demo')
    return run({
      incidentTime: when,
      description: DEMO_DESCRIPTION,
      lookback: 30,
      mode: 'demo',
      toast: 'Demo investigation loaded',
    })
  }, [run])

  /* Focus restoration lives here, with the open/close state, rather than in the
     panel's unmount cleanup. Tying it to an effect teardown made it dependent on
     React's commit ordering and on StrictMode's double-invoke, which captured
     the close button instead of the row that opened the panel. Recording the
     trigger at the moment of opening is unambiguous. */
  const triggerRef = useRef(null)

  const openDetail = useCallback((id) => {
    triggerRef.current = document.activeElement
    setSelectedId(id)
  }, [])

  const closeDetail = useCallback(() => {
    setSelectedId(null)
    const trigger = triggerRef.current
    triggerRef.current = null
    // One frame, so React has removed the panel before we move focus back.
    // setTimeout, not requestAnimationFrame: rAF callbacks do not run while the
    // tab is not compositing (backgrounded, or hidden behind another view), which
    // would silently strand keyboard focus on <body>. A macrotask still lands
    // after React has committed the unmount.
    setTimeout(() => {
      if (trigger?.isConnected) trigger.focus()
    }, 0)
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  const selectedChange = useMemo(
    () => result?.changes?.find((c) => c.event_id === selectedId) || null,
    [result, selectedId],
  )

  const value = useMemo(() => ({
    incidentTime, setIncidentTime,
    lookback, setLookback,
    description, setDescription,
    mode, setMode,
    result, loading, error, health, runCount,
    selectedId, setSelectedId, openDetail, selectedChange, closeDetail,
    toast, dismissToast,
    run, loadDemo,
  }), [
    incidentTime, lookback, description, mode, result, loading, error, health,
    runCount, selectedId, openDetail, selectedChange, closeDetail, toast, dismissToast,
    run, loadDemo,
  ])

  return (
    <InvestigationContext.Provider value={value}>
      {children}
    </InvestigationContext.Provider>
  )
}

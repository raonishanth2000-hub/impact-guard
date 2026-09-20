import { useState } from 'react'
import { Search, Play, LoaderCircle, ClipboardPaste, Check } from 'lucide-react'
import { Button, Field, INPUT_CLASS } from './primitives'
import { toLocalInputValue } from '../lib/format'

const WINDOWS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 180, label: '3 hours' },
]


/**
 * A datetime-local input cannot be pasted into — the browser renders it as
 * segmented digit fields, so an ISO string from a script, an alert or a log
 * line has to be retyped by hand. This accepts any timestamp Date can parse
 * and drives the picker from it.
 */
function PasteTimestamp({ onParsed }) {
  const [raw, setRaw] = useState('')
  const [state, setState] = useState('idle')   // idle | ok | bad

  const apply = (text) => {
    const trimmed = text.trim()
    if (!trimmed) { setState('idle'); return }
    const d = new Date(trimmed)
    if (Number.isNaN(d.getTime())) { setState('bad'); return }
    onParsed(toLocalInputValue(d))
    setState('ok')
    setTimeout(() => setState('idle'), 2200)
    setRaw('')
  }

  return (
    <details className="group/paste mt-1.5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1
                          text-[11.5px] text-ink-3 transition-colors duration-150
                          hover:text-ink-2">
        <ClipboardPaste size={11} strokeWidth={1.75} aria-hidden="true" />
        Paste a timestamp
      </summary>

      <div className="relative mt-1.5">
      <input
        type="text"
        value={raw}
        aria-label="Paste an ISO timestamp"
        placeholder="2026-09-19T13:54:45Z"
        onChange={(e) => { setRaw(e.target.value); setState('idle') }}
        onPaste={(e) => {
          // Apply immediately on paste — retyping is the thing being avoided.
          const text = e.clipboardData.getData('text')
          if (text) { e.preventDefault(); apply(text) }
        }}
        onBlur={(e) => apply(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(e.currentTarget.value) } }}
        className={`h-8 w-full rounded-control border bg-surface px-2.5 pr-7 font-mono
                    text-[11.5px] text-ink placeholder:text-ink-3 transition-colors
                    duration-150 focus:outline-none focus:ring-2 focus:ring-accent/15
                    ${state === 'bad' ? 'border-severe' : 'border-rule focus:border-accent'}`}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
        {state === 'ok'
          ? <Check size={12} strokeWidth={2.5} aria-hidden="true" className="text-positive-ink" />
          : <ClipboardPaste size={12} strokeWidth={1.75} aria-hidden="true" className="text-ink-3" />}
      </span>
      {state === 'bad' && (
        <p className="mt-1 text-[11px] text-severe">Not a timestamp I can read.</p>
      )}
      </div>
    </details>
  )
}

/**
 * Investigation controls. Reads as a sentence: at this time, looking back this
 * far, this went wrong, against this source.
 *
 * Labels sit above their inputs. The lookback is a real select rather than a
 * segmented control so the values can be spelled out in full.
 */
export default function ControlBar({
  incidentTime, setIncidentTime,
  lookback, setLookback,
  description, setDescription,
  mode, setMode,
  onInvestigate, onLoadDemo,
  loading,
}) {
  return (
    <section
      aria-label="Investigation parameters"
      className="rounded-card border border-rule bg-surface p-5 shadow-subtle"
    >
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          Investigation parameters
        </h2>
        <span className="text-[12px] text-ink-3">Times are local</span>
      </div>

      <div>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className="grid flex-1 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-[190px_170px_minmax(0,1fr)]">
            <Field label="Incident time" htmlFor="incident-time">
              <input
                id="incident-time"
                type="datetime-local"
                value={incidentTime}
                onChange={(e) => setIncidentTime(e.target.value)}
                max={toLocalInputValue(new Date())}
                className={`${INPUT_CLASS} font-mono tnum`}
              />
              <PasteTimestamp onParsed={setIncidentTime} />
            </Field>

            <Field label="Lookback window" htmlFor="lookback">
              <select
                id="lookback"
                value={lookback}
                onChange={(e) => setLookback(Number(e.target.value))}
                className={`${INPUT_CLASS} cursor-pointer appearance-none bg-[length:14px]
                            bg-[right_0.6rem_center] bg-no-repeat pr-8`}
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236f6b64' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
                }}
              >
                {WINDOWS.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </Field>

            <Field
              label="Incident description"
              hint="optional"
              htmlFor="symptom"
              className="sm:col-span-2 xl:col-span-1"
            >
              <input
                id="symptom"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Checkout requests started timing out"
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <Field label="Source" htmlFor="source-demo">
              <div
                role="group" aria-label="Data source"
                className="flex h-9 items-center rounded-control border border-rule bg-surface p-[3px]"
              >
                {[
                  { key: 'demo', label: 'Demo' },
                  { key: 'aws', label: 'Live AWS' },
                ].map((m) => {
                  const on = mode === m.key
                  return (
                    <button
                      key={m.key}
                      id={`source-${m.key}`}
                      type="button"
                      onClick={() => setMode(m.key)}
                      aria-pressed={on}
                      className={`h-full whitespace-nowrap rounded-[4px] px-2.5 text-[12.5px]
                                  transition-colors duration-150 cursor-pointer ${
                        on ? 'bg-sunken font-medium text-ink' : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onLoadDemo} disabled={loading} variant="secondary">
                <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                Sample change
              </Button>
              <Button onClick={onInvestigate} disabled={loading} variant="primary">
                {loading
                  ? <LoaderCircle size={14} strokeWidth={2} aria-hidden="true" className="animate-spin" />
                  : <Search size={14} strokeWidth={2} aria-hidden="true" />}
                {loading ? 'Analysing…' : 'Analyse impact'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

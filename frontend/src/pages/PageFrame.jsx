import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { NAV } from '../components/AppShell'

/**
 * Shared frame for the investigation pages: a title, an optional lede, and
 * previous/next links so the five views read as one ordered flow rather than
 * five disconnected tabs.
 */
export default function PageFrame({ current, title, lede, children }) {
  const steps = NAV.filter((n) => !n.always)
  const i = steps.findIndex((s) => s.to === current)
  const prev = i > 0 ? steps[i - 1] : null
  const next = i >= 0 && i < steps.length - 1 ? steps[i + 1] : null

  return (
    <div className="space-y-8">
      <header>
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
          Investigation
        </div>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.015em] text-ink">
          {title}
        </h1>
        {lede && (
          <p className="mt-2 max-w-[64ch] text-[13.5px] leading-relaxed text-ink-2">
            {lede}
          </p>
        )}
      </header>

      {children}

      <nav className="flex items-center justify-between gap-4 border-t border-rule pt-5"
           aria-label="Investigation steps">
        {prev ? (
          <Link to={prev.to}
                className="inline-flex items-center gap-1.5 text-[13px] text-ink-2
                           transition-colors duration-150 hover:text-ink">
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            {prev.label}
          </Link>
        ) : <span />}
        {next ? (
          <Link to={next.to}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium
                           text-accent-ink transition-opacity duration-150 hover:opacity-75">
            {next.label}
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ) : <span />}
      </nav>
    </div>
  )
}

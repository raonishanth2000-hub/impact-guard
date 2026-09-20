import {
  Database, FunctionSquare, Server, Archive, Scaling, Box, Globe, Key, Zap,
} from 'lucide-react'
import { relevanceStyle } from '../lib/format'

/**
 * Mark. A magnifier lens over a step in a trace line — the product finds the
 * moment a line moved. Drawn rather than imported so it inherits currentColor
 * and never depends on an emoji font.
 */
export function Mark({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         aria-hidden="true" className={className}>
      <path d="M2 17h4.2l2.6-8.4h2.4l2.2 6" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
      <circle cx="16" cy="11" r="5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m19.8 14.8 2.2 2.2" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" />
    </svg>
  )
}

const SERVICE_ICONS = {
  RDS: Database,
  Lambda: FunctionSquare,
  EC2: Server,
  S3: Archive,
  AutoScaling: Scaling,
  ELB: Scaling,
  ECS: Box,
  IAM: Key,
  APIGateway: Globe,
  CloudFront: Globe,
  DynamoDB: Database,
}

/** Decorative — always sits beside the visible service name. */
export function ServiceIcon({ service, size = 14, className = '' }) {
  const Icon = SERVICE_ICONS[service] || Zap
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" className={className} />
}

/**
 * Relevance badge. Colour plus code plus phrase — the words carry the meaning
 * on their own, so the badge survives greyscale printing and colour-blindness.
 */
export function RelevanceBadge({ relevance, showPhrase = false }) {
  const s = relevanceStyle(relevance)
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center rounded-control px-1.5 py-[3px]
                        text-[10.5px] font-semibold uppercase tracking-[0.06em]
                        ${s.badge}`}>
        {s.code}
      </span>
      {showPhrase && (
        <span className={`text-[12.5px] ${s.text}`}>{s.phrase}</span>
      )}
    </span>
  )
}

/** Environment marker. Text, never colour alone. */
export function Tag({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-sunken text-ink-2 ring-rule',
    accent: 'bg-accent-wash text-accent-ink ring-accent/20',
    positive: 'bg-positive-wash text-positive-ink ring-positive/25',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-[3px] font-mono
                      text-[10.5px] font-medium uppercase tracking-[0.06em]
                      ring-1 ${tones[tone]}`}>
      {children}
    </span>
  )
}

/**
 * Section. The default grouping device: a heading, a hairline, and content.
 * Used instead of a card wherever the content does not need to be lifted off
 * the page — which is most places.
 */
export function Section({ id, title, action, children, className = '' }) {
  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1
                      border-b border-rule pb-2.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {action && <div className="text-[12px] text-ink-3">{action}</div>}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  )
}

/** Card. Reserved for content that genuinely benefits from being lifted. */
export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-card border border-rule bg-surface shadow-subtle ${className}`}>
      {children}
    </div>
  )
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-button font-medium ' +
  'transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed ' +
  'disabled:opacity-50 whitespace-nowrap'

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-ink hover:bg-accent-hover',
  secondary: 'bg-surface text-ink ring-1 ring-rule hover:bg-sunken',
  tertiary: 'bg-transparent text-ink-2 hover:bg-sunken hover:text-ink',
}

const BUTTON_SIZES = {
  sm: 'h-8 px-2.5 text-[12.5px]',
  md: 'h-9 px-3.5 text-[13px]',
  lg: 'h-10 px-4 text-[13.5px]',
}

export function Button({
  variant = 'secondary', size = 'md', className = '', children, ...rest
}) {
  return (
    <button
      type="button"
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Labelled form field. Labels sit above inputs, never as placeholder-only. */
export function Field({ label, hint, htmlFor, children, className = '' }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor}
             className="mb-1.5 block text-[12px] font-medium text-ink-2">
        {label}
        {hint && <span className="ml-1.5 font-normal text-ink-3">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

export const INPUT_CLASS =
  'h-9 w-full rounded-control border border-rule bg-surface px-2.5 text-[13px] ' +
  'text-ink placeholder:text-ink-3 transition-colors duration-150 ' +
  'hover:border-ink-3/50 focus:border-accent focus:outline-none ' +
  'focus:ring-2 focus:ring-accent/15'

/** Key/value row for technical metadata. Values render monospace. */
export function DataRow({ label, value, mono = true, className = '' }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className={`grid grid-cols-[112px_1fr] items-baseline gap-4 py-2 ${className}`}>
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className={`break-words text-[12.5px] text-ink ${mono ? 'font-mono tnum' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

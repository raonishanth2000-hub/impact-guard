// Display helpers. Timestamps arrive as UTC ISO strings and render in the
// viewer's local timezone, which is what an on-call engineer reasons in.

/**
 * Status system.
 *
 * Every level carries a colour, a short code, and a plain-language phrase.
 * Colour is never the only carrier — a badge always renders the words too.
 *
 * Chromatic weight is rationed: HIGH gets a tinted badge, MEDIUM gets outline
 * only, LOW is warm grey. The incident itself is the single deep-red element
 * on the page.
 */
export const RELEVANCE = {
  HIGH: {
    code: 'HIGH',
    phrase: 'Potentially relevant',
    badge: 'bg-accent-wash text-accent-ink ring-1 ring-accent/25',
    text: 'text-accent-ink',
    dot: 'bg-accent',
    rule: 'bg-accent',
    rank: 3,
  },
  MEDIUM: {
    code: 'MED',
    phrase: 'Worth reviewing',
    badge: 'bg-transparent text-warning-ink ring-1 ring-warning/35',
    text: 'text-warning-ink',
    dot: 'bg-warning',
    rule: 'bg-warning',
    rank: 2,
  },
  LOW: {
    code: 'LOW',
    phrase: 'Background activity',
    badge: 'bg-transparent text-ink-3 ring-1 ring-rule',
    text: 'text-ink-3',
    dot: 'bg-ink-3/45',
    rule: 'bg-rule',
    rank: 1,
  },
}

export const relevanceStyle = (r) => RELEVANCE[r] || RELEVANCE.LOW

// Legacy alias so older imports keep resolving.
export const RELEVANCE_STYLES = RELEVANCE

export const SERVICE_LABELS = {
  RDS: 'Amazon RDS',
  Lambda: 'AWS Lambda',
  EC2: 'Amazon EC2',
  S3: 'Amazon S3',
  AutoScaling: 'EC2 Auto Scaling',
  ELB: 'Elastic Load Balancing',
  ECS: 'Amazon ECS',
  IAM: 'AWS IAM',
  APIGateway: 'Amazon API Gateway',
  CloudFront: 'Amazon CloudFront',
  DynamoDB: 'Amazon DynamoDB',
}

export const serviceLabel = (s) => SERVICE_LABELS[s] || s || 'AWS'

export const isProduction = (value = '') =>
  /(?:^|[-_./])(prod|prd|production|live)(?:[-_./]|$)/i.test(value)

export function formatClock(iso) {
  if (!iso) return '--:--'
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function formatClock12(iso) {
  if (!iso) return '--:--'
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

export function formatFull(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString([], {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

export function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString([], {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function formatOffset(minutes) {
  if (minutes === 0) return 'at the incident'
  const abs = Math.abs(minutes)
  const rounded = abs < 1 ? '<1' : Math.round(abs)
  const unit = rounded === 1 ? 'minute' : 'minutes'
  return minutes < 0 ? `${rounded} ${unit} before` : `${rounded} ${unit} after`
}

export function formatOffsetShort(minutes) {
  if (minutes === 0) return '0m'
  const abs = Math.abs(minutes)
  const rounded = abs < 1 ? '<1' : Math.round(abs)
  return `${minutes < 0 ? '−' : '+'}${rounded}m`
}

/**
 * Turn a scoring signal key into the evidence phrasing used by the insight
 * panel. Only signals that actually contributed are shown.
 */
export const SIGNAL_LABELS = {
  time_proximity: 'Temporal proximity',
  service_criticality: 'Request-path service',
  destructive_action: 'Destructive operation',
  security_sensitive: 'Security-sensitive change',
  production_resource: 'Production resource',
  configuration_change: 'Configuration change',
}

export function evidenceFrom(change) {
  if (!change?.signals) return []
  return Object.entries(change.signals)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => SIGNAL_LABELS[k] || k.replace(/_/g, ' '))
}

// datetime-local inputs are naive; convert to/from a local-time ISO string that
// carries the browser's real UTC offset so the backend interprets it correctly.
export function toLocalInputValue(date) {
  const d = new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function localInputToISO(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(offsetMin) / 60))
  const om = pad(Math.abs(offsetMin) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${oh}:${om}`
}

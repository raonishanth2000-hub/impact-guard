/**
 * Derive a resource graph from the investigation result.
 *
 * IMPORTANT: the backend has no dependency or topology model. CloudTrail records
 * individual API calls, not how resources relate. So every edge here must be
 * justified by something literally present in a change payload — we never invent
 * a connection to make the picture look fuller.
 *
 * Two evidence rules, both auditable in the UI:
 *
 *   reference  A change to resource A contains resource B's identifier in its
 *              request parameters. e.g. prod-checkout-api's environment
 *              variables hold ORDERS_DB_HOST=prod-orders-db…
 *
 *   port       A security-group rule opens a well-known database port, and a
 *              matching database resource exists in this window. e.g. 5432 with
 *              an RDS instance present.
 *
 * Anything we cannot evidence simply has no edge. A sparse honest graph beats a
 * dense invented one.
 */

import { isProduction, relevanceStyle, serviceLabel } from './format'

// Ports that identify a database engine well enough to be worth drawing.
const DB_PORTS = {
  5432: 'PostgreSQL',
  3306: 'MySQL / Aurora',
  1433: 'SQL Server',
  27017: 'MongoDB / DocumentDB',
  6379: 'Redis / ElastiCache',
}

const DB_SERVICES = new Set(['RDS', 'DynamoDB'])

/** Flatten a change_detail object to a searchable string. */
function payloadText(change) {
  try {
    return JSON.stringify(change.change_detail ?? {})
  } catch {
    return ''
  }
}

/** Pull every port number out of a security-group style payload. */
function portsIn(change) {
  const found = new Set()
  const walk = (v) => {
    if (!v || typeof v !== 'object') return
    for (const [k, val] of Object.entries(v)) {
      if ((k === 'fromPort' || k === 'toPort') && typeof val === 'number') found.add(val)
      else walk(val)
    }
  }
  walk(change.change_detail)
  return [...found]
}

/**
 * Build { nodes, edges } where each node is a real resource that changed and
 * each edge carries the evidence that justifies it.
 */
export function buildTopology(changes = []) {
  // One node per distinct resource, carrying its most relevant change.
  const byResource = new Map()

  for (const c of changes) {
    if (!c.resource_id || c.resource_id === 'unknown') continue
    const existing = byResource.get(c.resource_id)
    const rank = relevanceStyle(c.relevance).rank
    if (!existing || rank > relevanceStyle(existing.topChange.relevance).rank) {
      byResource.set(c.resource_id, {
        id: c.resource_id,
        service: c.aws_service,
        serviceLabel: serviceLabel(c.aws_service),
        resourceType: c.resource_type,
        production: isProduction(c.resource_id),
        topChange: c,
        changes: existing ? [...existing.changes, c] : [c],
      })
    } else {
      existing.changes.push(c)
    }
  }

  const nodes = [...byResource.values()].map((n) => ({
    ...n,
    // Node state is derived from the ranking, not invented health telemetry.
    // We deliberately do NOT claim "healthy" for resources we have no signal on.
    state: n.topChange.relevance === 'HIGH'
      ? 'attention'
      : n.topChange.relevance === 'MEDIUM'
        ? 'changed'
        : 'quiet',
    changeCount: n.changes.length,
    earliest: n.changes.reduce((a, c) => Math.min(a, c.minutes_from_incident), Infinity),
  }))

  const ids = nodes.map((n) => n.id)
  const edges = []
  const seen = new Set()

  const add = (source, target, evidence) => {
    if (source === target) return
    const key = `e_${source}__${target}`.replace(/[^\w]/g, '_')
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ id: key, source, target, evidence })
  }

  for (const node of nodes) {
    for (const change of node.changes) {
      const text = payloadText(change)

      // Rule 1: the payload literally names another resource in this window.
      for (const otherId of ids) {
        if (otherId === node.id) continue
        if (text.includes(otherId)) {
          add(node.id, otherId, {
            kind: 'reference',
            label: 'references',
            detail: `${change.event_name} on ${node.id} contains "${otherId}" in its request parameters.`,
            eventId: change.event_id,
          })
        }
      }

      // Rule 2: a security-group rule opens a known database port and a matching
      // database resource exists in this window.
      if (change.category === 'security') {
        for (const port of portsIn(change)) {
          const engine = DB_PORTS[port]
          if (!engine) continue
          for (const db of nodes) {
            if (!DB_SERVICES.has(db.service)) continue
            add(node.id, db.id, {
              kind: 'port',
              label: `port ${port}`,
              detail: `${change.event_name} on ${node.id} opened port ${port} (${engine}), and ${db.id} is a ${db.serviceLabel} resource in this window.`,
              eventId: change.event_id,
            })
          }
        }
      }
    }
  }

  return { nodes, edges }
}

/**
 * Lay nodes out in service columns. Deterministic, so the graph does not
 * reshuffle between renders — which would make the replay unreadable.
 */
const COLUMN_ORDER = ['EC2', 'ELB', 'APIGateway', 'Lambda', 'ECS', 'RDS', 'DynamoDB', 'S3', 'AutoScaling', 'IAM']

export function layoutTopology(nodes) {
  const columns = new Map()
  for (const n of nodes) {
    const key = n.service
    if (!columns.has(key)) columns.set(key, [])
    columns.get(key).push(n)
  }

  const ordered = [...columns.entries()].sort((a, b) => {
    const ai = COLUMN_ORDER.indexOf(a[0]); const bi = COLUMN_ORDER.indexOf(b[0])
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const COL_W = 260
  const ROW_H = 118
  const positioned = []

  ordered.forEach(([, group], colIndex) => {
    // Most-relevant first within a column, so attention sits near the top.
    group
      .slice()
      .sort((a, b) => b.topChange.score - a.topChange.score)
      .forEach((node, rowIndex) => {
        positioned.push({
          ...node,
          position: {
            x: colIndex * COL_W,
            y: rowIndex * ROW_H - ((group.length - 1) * ROW_H) / 2,
          },
        })
      })
  })

  return positioned
}

/**
 * Incident risk, taken straight from the deterministic scoring engine — the
 * highest score among changes that preceded the incident. Nothing here is a new
 * number: it is the same value the ranking already showed, surfaced larger.
 */
export function incidentRisk(changes = []) {
  const before = changes.filter((c) => c.occurred_before_incident)
  if (!before.length) return { score: 0, band: 'none', lead: null, factors: [] }

  const lead = before.reduce((a, c) => (c.score > a.score ? c : a), before[0])
  const band = lead.score >= 65 ? 'high' : lead.score >= 40 ? 'medium' : 'low'

  return { score: lead.score, band, lead, factors: lead.reasons || [] }
}

/** Neighbours of a node, for Focus Mode. */
export function neighboursOf(edges, id) {
  const near = new Set([id])
  for (const e of edges) {
    if (e.source === id) near.add(e.target)
    if (e.target === id) near.add(e.source)
  }
  return near
}

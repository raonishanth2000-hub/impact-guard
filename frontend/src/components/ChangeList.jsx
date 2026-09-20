import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { RelevanceBadge, Section, ServiceIcon, Tag } from './primitives'
import {
  formatClock12, formatOffset, isProduction, relevanceStyle, serviceLabel,
} from '../lib/format'

/**
 * One ranked change. A list row rather than a card — the rows already sit in a
 * bordered container, so wrapping each one again would be noise.
 *
 * Reading order matches the questions an engineer asks: how much should I care,
 * what changed, where and who, why was it ranked.
 */
function ChangeRow({ change, onOpen, selected, isLast }) {
  const s = relevanceStyle(change.relevance)
  const prod = isProduction(change.resource_id)

  return (
    <li className={isLast ? '' : 'border-b border-rule-soft'}>
      <button
        type="button"
        onClick={() => onOpen(change.event_id)}
        aria-current={selected ? 'true' : undefined}
        className={`group relative flex w-full gap-4 px-4 py-3.5 text-left
                    transition-colors duration-150 cursor-pointer hover:bg-sunken/55
                    ${selected ? 'bg-sunken/70' : ''}`}
      >
        {/* Only the top band gets an edge marker. */}
        {change.relevance === 'HIGH' && (
          <span className={`absolute inset-y-0 left-0 w-[2px] ${s.rule}`} aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <RelevanceBadge relevance={change.relevance} />
            {prod && <Tag>Production</Tag>}
          </div>

          <h3 className="mt-2 text-[14px] font-medium leading-snug text-ink">
            {change.action_summary}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1
                          text-[12px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <ServiceIcon service={change.aws_service} size={12} className="text-ink-3" />
              {serviceLabel(change.aws_service)}
            </span>
            <span className="text-rule" aria-hidden="true">|</span>
            <span className="font-mono">{change.actor}</span>
          </div>

          {change.reasons?.[0] && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
              {change.reasons[0]}.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          <time dateTime={change.event_time}
                className="font-mono text-[12.5px] text-ink tnum">
            {formatClock12(change.event_time)}
          </time>
          <span className="text-[11.5px] text-ink-3">
            {formatOffset(change.minutes_from_incident)}
          </span>
          <ChevronRight
            size={15} strokeWidth={1.75} aria-hidden="true"
            className="mt-1 text-ink-3 transition-transform duration-150
                       group-hover:translate-x-0.5"
          />
        </div>
      </button>
    </li>
  )
}

export default function ChangeList({ changes, selectedId, onSelect }) {
  const [showAll, setShowAll] = useState(false)
  const relevant = changes.filter((c) => c.relevance !== 'LOW')
  const rest = changes.filter((c) => c.relevance === 'LOW')

  return (
    <Section
      id="changes"
      title="Potentially relevant changes"
      action="Ranked by relevance"
    >
      {relevant.length === 0 ? (
        <p className="rounded-card border border-rule bg-surface px-4 py-8 text-center
                      text-[13px] text-ink-2">
          Nothing in this window scored above the low threshold.
        </p>
      ) : (
        <div className="overflow-hidden rounded-card border border-rule bg-surface shadow-subtle">
          <ul>
            {relevant.map((c, i) => (
              <ChangeRow
                key={c.event_id}
                change={c}
                selected={selectedId === c.event_id}
                onOpen={onSelect}
                isLast={i === relevant.length - 1 && !showAll && rest.length === 0}
              />
            ))}
            {showAll && rest.map((c, i) => (
              <ChangeRow
                key={c.event_id}
                change={c}
                selected={selectedId === c.event_id}
                onOpen={onSelect}
                isLast={i === rest.length - 1}
              />
            ))}
          </ul>

          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="flex w-full items-center justify-center gap-1.5 border-t border-rule
                         bg-sunken/35 py-2.5 text-[12.5px] text-ink-2 transition-colors
                         duration-150 cursor-pointer hover:bg-sunken hover:text-ink"
            >
              <ChevronDown
                size={14} strokeWidth={1.75} aria-hidden="true"
                className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`}
              />
              {showAll
                ? 'Hide background activity'
                : `Show ${rest.length} lower-relevance ${rest.length === 1 ? 'change' : 'changes'}`}
            </button>
          )}
        </div>
      )}
    </Section>
  )
}

"""Core data structures.

Two shapes matter:
  NormalizedChange - one AWS change, service-agnostic and human readable.
  ScoredChange     - the same change plus its relevance to a specific incident.

Keeping scoring out of NormalizedChange means the same change can be scored
against different incidents without being re-normalized.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class NormalizedChange:
    event_id: str
    event_name: str
    event_time: datetime
    aws_service: str
    action_summary: str
    resource_id: str
    resource_type: str
    actor: str
    actor_type: str
    region: str
    source_ip: str = ""
    user_agent: str = ""
    category: str = "other"
    change_detail: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    # Whether this event name is in our catalog. Unknown events still surface,
    # they just score lower and get a generic summary.
    known_event: bool = True
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, include_raw: bool = False) -> dict[str, Any]:
        out = {
            "event_id": self.event_id,
            "event_name": self.event_name,
            "event_time": _iso(self.event_time),
            "aws_service": self.aws_service,
            "action_summary": self.action_summary,
            "resource_id": self.resource_id,
            "resource_type": self.resource_type,
            "actor": self.actor,
            "actor_type": self.actor_type,
            "region": self.region,
            "source_ip": self.source_ip,
            "user_agent": self.user_agent,
            "category": self.category,
            "change_detail": self.change_detail,
            "error_code": self.error_code,
            "known_event": self.known_event,
        }
        if include_raw:
            out["raw"] = self.raw
        return out


@dataclass
class ScoredChange:
    change: NormalizedChange
    score: int
    relevance: str  # HIGH | MEDIUM | LOW
    reasons: list[str]
    signals: dict[str, int]
    minutes_from_incident: float  # negative = before the incident

    @property
    def occurred_before_incident(self) -> bool:
        return self.minutes_from_incident <= 0

    def to_dict(self, include_raw: bool = False) -> dict[str, Any]:
        from . import narrative  # local import: narrative reads models
        return {
            **self.change.to_dict(include_raw=include_raw),
            "narrative": narrative.describe(self.change),
            "score": self.score,
            "relevance": self.relevance,
            "reasons": self.reasons,
            "signals": self.signals,
            "minutes_from_incident": round(self.minutes_from_incident, 1),
            "occurred_before_incident": self.occurred_before_incident,
        }

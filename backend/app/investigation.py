"""Orchestration: fetch -> normalize -> score -> explain.

The only module that knows about both data sources and Bedrock. Everything it
calls is independently testable.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from . import bedrock, cloudtrail, config, demo_data, narrative, normalizer, scoring
from .errors import ValidationError
from .models import ScoredChange

log = logging.getLogger(__name__)

# Changes made shortly AFTER an incident are usually remediation, and are useful
# context during a post-mortem, so we include a short tail beyond the incident.
POST_INCIDENT_BUFFER_MINUTES = 5


def parse_incident_time(value: str | None) -> datetime:
    """Parse an ISO-8601 incident time. Offsets like +05:30 are honoured."""
    if not value:
        return datetime.now(timezone.utc)

    if not isinstance(value, str):
        raise ValidationError("incident_time must be an ISO-8601 string.")

    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValidationError(
            "incident_time is not a valid ISO-8601 timestamp.",
            detail="Expected something like 2026-09-19T10:42:00+05:30.",
        ) from exc

    # A bare timestamp is interpreted as UTC rather than silently using server local time.
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    if parsed > now + timedelta(minutes=5):
        raise ValidationError("incident_time is in the future.")

    return parsed


def validate_lookback(value: Any) -> int:
    if value is None:
        return 30
    try:
        minutes = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError("lookback_minutes must be an integer.") from exc

    if minutes < 1:
        raise ValidationError("lookback_minutes must be at least 1.")
    if minutes > config.MAX_LOOKBACK_MINUTES:
        raise ValidationError(
            f"lookback_minutes cannot exceed {config.MAX_LOOKBACK_MINUTES}."
        )
    return minutes


def resolve_data_source(requested: str | None) -> str:
    """Per-request override, falling back to the configured default."""
    source = (requested or config.DATA_SOURCE or "demo").strip().lower()
    if source not in ("demo", "aws"):
        raise ValidationError("mode must be either 'demo' or 'aws'.")
    return source


def collect_changes(
    start_time: datetime,
    end_time: datetime,
    data_source: str,
    incident_time: datetime | None = None,
) -> list:
    """Fetch raw events from the selected source and normalize them."""
    if data_source == "demo":
        raw = demo_data.fetch_demo_events(start_time, end_time, incident_time)
    else:
        raw = cloudtrail.fetch_events(start_time, end_time)

    return normalizer.normalize_many(raw)


def _stats(scored: list[ScoredChange]) -> dict[str, int]:
    return {
        "total": len(scored),
        "high": sum(1 for s in scored if s.relevance == "HIGH"),
        "medium": sum(1 for s in scored if s.relevance == "MEDIUM"),
        "low": sum(1 for s in scored if s.relevance == "LOW"),
        "before_incident": sum(1 for s in scored if s.occurred_before_incident),
    }


def _timeline(scored: list[ScoredChange], incident_time: datetime, description: str | None):
    """Chronological entries with the incident spliced in at the right position."""
    entries: list[dict[str, Any]] = [
        {
            "type": "change",
            "event_id": s.change.event_id,
            "time": s.change.to_dict()["event_time"],
            "label": s.change.action_summary,
            "service": s.change.aws_service,
            "actor": s.change.actor,
            "relevance": s.relevance,
            "minutes_from_incident": round(s.minutes_from_incident, 1),
        }
        for s in scored
    ]

    entries.append(
        {
            "type": "incident",
            "event_id": "incident",
            "time": incident_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "label": description or "Incident reported",
            "service": None,
            "actor": None,
            "relevance": None,
            "minutes_from_incident": 0.0,
        }
    )

    entries.sort(key=lambda e: e["time"])
    return entries


def investigate(
    incident_time_raw: str | None,
    lookback_minutes_raw: Any,
    description: str | None,
    mode: str | None,
    explain: bool = True,
) -> dict[str, Any]:
    """Run a full investigation and return the API payload."""
    incident_time = parse_incident_time(incident_time_raw)
    lookback = validate_lookback(lookback_minutes_raw)
    data_source = resolve_data_source(mode)

    if description is not None and not isinstance(description, str):
        raise ValidationError("description must be a string.")
    if description and len(description) > 2000:
        raise ValidationError("description must be 2000 characters or fewer.")

    start_time = incident_time - timedelta(minutes=lookback)
    end_time = incident_time + timedelta(minutes=POST_INCIDENT_BUFFER_MINUTES)

    changes = collect_changes(start_time, end_time, data_source, incident_time)
    scored = scoring.score_and_rank(changes, incident_time, lookback)

    # Only the top-scoring events go to Bedrock: it bounds cost and latency, and
    # low-relevance noise makes the explanation worse, not better.
    to_explain = scored[: config.MAX_EVENTS_TO_EXPLAIN]
    incident_iso = incident_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    if explain:
        explanation = bedrock.explain(to_explain, incident_iso, description)
    else:
        explanation = bedrock.fallback_explanation(to_explain, description)
        explanation["ai_available"] = False
        explanation["ai_status"] = bedrock.STATUS_NOT_CONFIGURED
        explanation["ai_error"] = "Explanation was not requested."

    incident_block = {
        "time": incident_iso,
        "description": description or None,
        "lookback_minutes": lookback,
        "window": {
            "start": start_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "end": end_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
    }
    stats = _stats(scored)

    return {
        "incident": incident_block,
        "briefing": narrative.briefing(scored, incident_block, stats),
        "data_source": data_source,
        "stats": stats,
        "timeline": _timeline(scored, incident_time, description),
        "changes": [s.to_dict() for s in scored],
        "explanation": explanation,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }

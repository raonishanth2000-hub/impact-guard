"""Deterministic relevance scoring.

Runs BEFORE Bedrock. This is on purpose: the ranking must be explainable and
reproducible without a model in the loop. Bedrock explains what this engine
selected; it never does the selecting.

No machine learning. Transparent additive signals, each capped, total capped at
100. Every point added also appends a human-readable reason, so the UI can
justify a ranking even with AI disabled.
"""

import re
from datetime import datetime

from . import catalog
from .models import NormalizedChange, ScoredChange

# Signal ceilings. Tuned so that "production resource changed 1 minute before the
# incident" clears HIGH on its own, which is the behaviour an on-call engineer expects.
MAX_TIME_PROXIMITY = 50
MAX_CRITICALITY = 12
MAX_DESTRUCTIVE = 18
MAX_SECURITY = 12
MAX_PRODUCTION = 15
MAX_CONFIG = 8

HIGH_THRESHOLD = 65
MEDIUM_THRESHOLD = 40

# Matches prod / prd / production / live as a word-ish token inside a resource name.
_PRODUCTION_PATTERN = re.compile(r"(?:^|[-_./])(prod|prd|production|live)(?:[-_./]|$)", re.I)

# Changes landing after the incident cannot have caused it. We keep them visible
# (they may be remediation, or the incident's blast radius) but push them down.
POST_INCIDENT_PENALTY = 0.15

# Decay exponent > 1 makes proximity fall off faster as a change gets older.
# Without this, a strongly-signalled change 7 minutes out can outrank a change to
# the production database 1 minute out, which is not how an engineer triages.
PROXIMITY_DECAY_EXPONENT = 1.5


def looks_production(*values: str) -> bool:
    return any(_PRODUCTION_PATTERN.search(v or "") for v in values)


def _time_proximity_points(minutes_from_incident: float, window_minutes: int) -> int:
    """Linear decay from the incident backwards across the window.

    minutes_from_incident is negative for changes before the incident.
    """
    if window_minutes <= 0:
        return 0

    if minutes_from_incident > 0:
        # After the incident: small residual score, decaying fast.
        decayed = max(0.0, 1.0 - (minutes_from_incident / window_minutes))
        return int(MAX_TIME_PROXIMITY * decayed * POST_INCIDENT_PENALTY)

    age = abs(minutes_from_incident)
    if age > window_minutes:
        return 0
    remaining = 1.0 - (age / window_minutes)
    return int(MAX_TIME_PROXIMITY * (remaining ** PROXIMITY_DECAY_EXPONENT))


def _describe_timing(minutes_from_incident: float) -> str:
    age = abs(minutes_from_incident)
    if age < 1:
        unit = "less than a minute"
    elif age < 2:
        unit = "1 minute"
    else:
        unit = f"{int(round(age))} minutes"
    direction = "before" if minutes_from_incident <= 0 else "after"
    return f"Occurred {unit} {direction} the reported incident"


def score_change(
    change: NormalizedChange, incident_time: datetime, window_minutes: int
) -> ScoredChange:
    spec = catalog.get_spec(change.event_name)
    reasons: list[str] = []
    signals: dict[str, int] = {}

    minutes_from_incident = (change.event_time - incident_time).total_seconds() / 60.0

    # 1. Time proximity - the dominant signal.
    proximity = _time_proximity_points(minutes_from_incident, window_minutes)
    signals["time_proximity"] = proximity
    if proximity > 0:
        reasons.append(_describe_timing(minutes_from_incident))
    if minutes_from_incident > 0:
        reasons.append("Occurred after the incident began, so it cannot be a trigger")

    # 2. Service criticality.
    criticality = min(catalog.service_criticality(change.aws_service), MAX_CRITICALITY)
    signals["service_criticality"] = criticality
    if criticality >= 10:
        reasons.append(f"Affects {change.aws_service}, a service on the application request path")

    # 3. Destructive action.
    destructive = MAX_DESTRUCTIVE if (spec and spec.destructive) else 0
    signals["destructive_action"] = destructive
    if destructive:
        reasons.append("Potentially destructive action (removes or stops a resource)")

    # 4. Security sensitivity.
    security = MAX_SECURITY if (spec and spec.security_sensitive) else 0
    signals["security_sensitive"] = security
    if security:
        reasons.append("Security-sensitive change (network access or resource policy)")

    # 5. Production-like naming.
    production = MAX_PRODUCTION if looks_production(change.resource_id) else 0
    signals["production_resource"] = production
    if production:
        reasons.append(f"Targets a production-like resource ({change.resource_id})")

    # 6. Configuration change.
    config = MAX_CONFIG if (spec and spec.configuration_change) else 0
    signals["configuration_change"] = config
    if config:
        reasons.append("Configuration change rather than a read-only operation")

    # Failed calls rarely change anything - note it and damp the score.
    score = sum(signals.values())
    if change.error_code:
        score = int(score * 0.4)
        reasons.append(f"API call failed with {change.error_code}, so it likely changed nothing")

    score = max(0, min(100, score))

    if score >= HIGH_THRESHOLD:
        relevance = "HIGH"
    elif score >= MEDIUM_THRESHOLD:
        relevance = "MEDIUM"
    else:
        relevance = "LOW"

    # A change made after the incident began cannot be a contributing cause, so it
    # never earns the HIGH band no matter how strong its other signals are. It stays
    # visible because it is often remediation worth seeing in a post-mortem.
    if minutes_from_incident > 0 and relevance == "HIGH":
        relevance = "MEDIUM"

    return ScoredChange(
        change=change,
        score=score,
        relevance=relevance,
        reasons=reasons,
        signals=signals,
        minutes_from_incident=minutes_from_incident,
    )


def score_and_rank(
    changes: list[NormalizedChange], incident_time: datetime, window_minutes: int
) -> list[ScoredChange]:
    """Score every change and return them most-relevant first.

    Ties break toward the change closest to the incident, which is the more
    useful ordering when two changes score identically.
    """
    scored = [score_change(c, incident_time, window_minutes) for c in changes]
    scored.sort(key=lambda s: (-s.score, abs(s.minutes_from_incident)))
    return scored

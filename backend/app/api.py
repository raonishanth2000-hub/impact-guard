"""Framework-agnostic route handlers.

Each handler takes plain dicts and returns (status_code, body). Both the local
dev server and the Lambda adapter call `dispatch`, so there is exactly one
implementation of the API regardless of where it runs.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from . import catalog, config, investigation, scoring, bedrock
from .errors import ApiError, NotFoundError, ValidationError

log = logging.getLogger(__name__)


def health(_query: dict, _body: dict) -> tuple[int, dict]:
    return 200, {
        "status": "ok",
        "service": "impact-guard",
        "time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "config": config.public_config(),
        # Credential diagnostics named the provider, the profile and the first
        # four characters of the access key. Useful locally, and nobody else's
        # business on a public endpoint — so they are only attached when live
        # AWS is enabled, which the hosted demo never is.
        **({"credentials": bedrock.credential_status()}
           if config.LIVE_AWS_ALLOWED else {}),
        "supported_events": catalog.supported_events(),
    }


def list_events(query: dict, _body: dict) -> tuple[int, dict]:
    """Recent changes without incident scoring - the 'what's been happening' view."""
    minutes = investigation.validate_lookback(query.get("minutes", 30))
    data_source = investigation.resolve_data_source(query.get("mode"))

    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(minutes=minutes)

    changes = investigation.collect_changes(start_time, end_time, data_source, end_time)
    # Score against "now" so the list still has a sensible ordering.
    scored = scoring.score_and_rank(changes, end_time, minutes)

    return 200, {
        "data_source": data_source,
        "window": {
            "start": start_time.isoformat().replace("+00:00", "Z"),
            "end": end_time.isoformat().replace("+00:00", "Z"),
            "minutes": minutes,
        },
        "count": len(scored),
        "events": [s.to_dict() for s in scored],
    }


def investigate(_query: dict, body: dict) -> tuple[int, dict]:
    result = investigation.investigate(
        incident_time_raw=body.get("incident_time"),
        lookback_minutes_raw=body.get("lookback_minutes", 30),
        description=body.get("description"),
        mode=body.get("mode"),
        explain=bool(body.get("explain", True)),
    )
    return 200, result


def explain(_query: dict, body: dict) -> tuple[int, dict]:
    """Re-run only the AI explanation, optionally for a subset of events.

    Useful for retrying after enabling Bedrock without refetching everything.
    """
    incident_time = investigation.parse_incident_time(body.get("incident_time"))
    lookback = investigation.validate_lookback(body.get("lookback_minutes", 30))
    data_source = investigation.resolve_data_source(body.get("mode"))
    description = body.get("description")

    event_ids = body.get("event_ids")
    if event_ids is not None and not isinstance(event_ids, list):
        raise ValidationError("event_ids must be a list of event id strings.")

    start_time = incident_time - timedelta(minutes=lookback)
    end_time = incident_time + timedelta(minutes=investigation.POST_INCIDENT_BUFFER_MINUTES)

    changes = investigation.collect_changes(start_time, end_time, data_source, incident_time)
    scored = scoring.score_and_rank(changes, incident_time, lookback)

    if event_ids:
        wanted = set(event_ids)
        scored = [s for s in scored if s.change.event_id in wanted]
        if not scored:
            raise NotFoundError("None of the supplied event_ids were found in this window.")

    incident_iso = incident_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    explanation = bedrock.explain(
        scored[: config.MAX_EVENTS_TO_EXPLAIN], incident_iso, description
    )
    return 200, {"incident_time": incident_iso, "explanation": explanation}


# (method, path) -> handler
ROUTES = {
    ("GET", "/health"): health,
    ("GET", "/events"): list_events,
    ("POST", "/investigate"): investigate,
    ("POST", "/explain"): explain,
}


def dispatch(method: str, path: str, query: dict, body: dict) -> tuple[int, dict]:
    """Route a request, converting every failure into a structured JSON body."""
    path = "/" + path.strip("/") if path.strip("/") else "/"
    handler = ROUTES.get((method.upper(), path))

    if handler is None:
        if path == "/":
            return 200, {
                "service": "impact-guard",
                "endpoints": [f"{m} {p}" for m, p in sorted(ROUTES)],
            }
        return 404, {
            "error": {
                "code": "not_found",
                "message": f"No route for {method.upper()} {path}",
                "detail": f"Available: {', '.join(f'{m} {p}' for m, p in sorted(ROUTES))}",
            }
        }

    try:
        return handler(query, body)
    except ApiError as exc:
        return exc.status_code, exc.to_dict()
    except Exception:  # noqa: BLE001 - never leak internals to the client
        log.exception("Unhandled error in %s %s", method, path)
        return 500, {
            "error": {
                "code": "internal_error",
                "message": "An unexpected error occurred while handling the request.",
            }
        }

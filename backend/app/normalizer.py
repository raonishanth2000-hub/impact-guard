"""Turn raw CloudTrail records into NormalizedChange objects.

Handles both shapes we encounter:
  1. CloudTrail LookupEvents records, where the useful payload is a JSON *string*
     under "CloudTrailEvent".
  2. Plain CloudTrail event dicts (what our demo generator produces, and what an
     S3/EventBridge delivery looks like).

Normalization never raises on odd input. A malformed record degrades to a
low-information change rather than breaking the whole investigation.
"""

import json
from datetime import datetime, timezone
from typing import Any

from . import catalog
from .models import NormalizedChange

# eventSource ("rds.amazonaws.com") -> the short service name we display.
_SERVICE_BY_SOURCE = {
    "rds": "RDS",
    "lambda": "Lambda",
    "ec2": "EC2",
    "s3": "S3",
    "autoscaling": "AutoScaling",
    "iam": "IAM",
    "elasticloadbalancing": "ELB",
    "ecs": "ECS",
    "apigateway": "APIGateway",
    "cloudfront": "CloudFront",
    "dynamodb": "DynamoDB",
    "sts": "STS",
}


def _parse_time(value: Any) -> datetime:
    """Accept datetime, epoch number, or ISO/Zulu string. Always return UTC-aware."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(value, tz=timezone.utc)
    elif isinstance(value, str):
        text = value.strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _service_from_source(event_source: str, fallback: str = "AWS") -> str:
    prefix = (event_source or "").split(".")[0].lower()
    return _SERVICE_BY_SOURCE.get(prefix, prefix.upper() if prefix else fallback)


def _extract_actor(user_identity: dict) -> tuple[str, str]:
    """Return (actor, actor_type).

    For assumed roles the raw userName is a session name, which is noise. The
    role name from sessionIssuer is what an engineer actually recognises
    ("deploy-role"), so prefer it.
    """
    if not isinstance(user_identity, dict):
        return "unknown", "unknown"

    identity_type = user_identity.get("type", "unknown")

    session_issuer = (user_identity.get("sessionContext") or {}).get("sessionIssuer") or {}
    if session_issuer.get("userName"):
        return session_issuer["userName"], identity_type

    if user_identity.get("userName"):
        return user_identity["userName"], identity_type

    if user_identity.get("invokedBy"):
        return user_identity["invokedBy"], identity_type

    arn = user_identity.get("arn") or ""
    if arn:
        return arn.split("/")[-1] or arn, identity_type

    return user_identity.get("principalId", "unknown"), identity_type


def _walk_for_ids(value: Any, depth: int = 0) -> list[str]:
    """Pull identifier-ish strings out of nested requestParameters.

    EC2 in particular nests ids as {"instancesSet": {"items": [{"instanceId": ...}]}}.
    """
    if depth > 4:
        return []
    found: list[str] = []
    if isinstance(value, dict):
        for key, val in value.items():
            if isinstance(val, str) and key.lower().endswith(("id", "name", "identifier")):
                found.append(val)
            else:
                found.extend(_walk_for_ids(val, depth + 1))
    elif isinstance(value, list):
        for item in value:
            found.extend(_walk_for_ids(item, depth + 1))
    return found


def _extract_resource(
    params: dict, spec: catalog.EventSpec | None, record_resources: list
) -> str:
    # 1. Catalog-declared keys are the most reliable.
    if spec:
        for key in spec.resource_keys:
            val = params.get(key)
            if isinstance(val, str) and val:
                return val
            if isinstance(val, (dict, list)):
                ids = _walk_for_ids(val)
                if ids:
                    return ", ".join(ids[:3])

    # 2. CloudTrail's own Resources block (LookupEvents only).
    for res in record_resources or []:
        name = (res or {}).get("ResourceName")
        if name:
            return name

    # 3. Last resort: anything identifier-shaped in the parameters.
    ids = _walk_for_ids(params)
    return ids[0] if ids else "unknown"


def _humanize(event_name: str) -> str:
    """Fallback summary for events not in the catalog: 'ModifyDBInstance' -> 'Modify DB Instance'."""
    out: list[str] = []
    for i, ch in enumerate(event_name):
        if ch.isupper() and i and not event_name[i - 1].isupper():
            out.append(" ")
        out.append(ch)
    return "".join(out)


def normalize(record: dict) -> NormalizedChange:
    # LookupEvents wraps the real event in a JSON string.
    inner: dict[str, Any] = {}
    raw_inner = record.get("CloudTrailEvent")
    if isinstance(raw_inner, str):
        try:
            inner = json.loads(raw_inner)
        except (json.JSONDecodeError, TypeError):
            inner = {}
    elif isinstance(raw_inner, dict):
        inner = raw_inner

    # Prefer the inner event, fall back to the outer record.
    src: dict[str, Any] = {**record, **inner} if inner else dict(record)

    event_name = src.get("eventName") or src.get("EventName") or "UnknownEvent"
    spec = catalog.get_spec(event_name)

    params = src.get("requestParameters") or {}
    if not isinstance(params, dict):
        params = {}

    resource_id = _extract_resource(params, spec, record.get("Resources") or [])
    actor, actor_type = _extract_actor(src.get("userIdentity") or {})

    if spec:
        service = spec.service
        summary = spec.summary.format(resource=resource_id)
        category = spec.category
        resource_type = spec.resource_type
        detail = {k: params[k] for k in spec.detail_keys if k in params}
    else:
        service = _service_from_source(src.get("eventSource", ""))
        summary = f"{_humanize(event_name)} on {resource_id}"
        category = "other"
        resource_type = "resource"
        # Unknown event: surface a bounded slice of params rather than nothing.
        detail = {k: v for k, v in list(params.items())[:6]}

    return NormalizedChange(
        event_id=src.get("eventID") or src.get("EventId") or f"{event_name}-{src.get('eventTime')}",
        event_name=event_name,
        event_time=_parse_time(src.get("eventTime") or src.get("EventTime")),
        aws_service=service,
        action_summary=summary,
        resource_id=resource_id,
        resource_type=resource_type,
        actor=actor,
        actor_type=actor_type,
        region=src.get("awsRegion", ""),
        source_ip=src.get("sourceIPAddress", ""),
        user_agent=src.get("userAgent", ""),
        category=category,
        change_detail=detail,
        error_code=src.get("errorCode"),
        known_event=spec is not None,
        raw=src,
    )


def normalize_many(records: list[dict]) -> list[NormalizedChange]:
    """Normalize a batch, dropping anything unparseable rather than failing the request."""
    out = []
    for record in records:
        try:
            out.append(normalize(record))
        except Exception:  # noqa: BLE001 - one bad record must not kill an investigation
            continue
    return out

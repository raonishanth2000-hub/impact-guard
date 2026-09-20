"""Live CloudTrail event collection.

Uses the CloudTrail LookupEvents API, which serves the last 90 days of
management events with no extra infrastructure - no trail, no S3 bucket, no
Athena table. That keeps the deployment footprint tiny, which matters more here
than the throughput a full trail would give us.

boto3 is imported lazily so that demo mode works on a machine with no AWS SDK.
"""

import logging
from datetime import datetime
from typing import Any

from . import config
from .errors import UpstreamPermissionError, UpstreamUnavailableError

log = logging.getLogger(__name__)

# LookupEvents caps page size at 50.
_PAGE_SIZE = 50


def _client():
    import boto3  # noqa: PLC0415 - intentional lazy import

    return boto3.client("cloudtrail", region_name=config.AWS_REGION)


def fetch_events(
    start_time: datetime, end_time: datetime, max_events: int | None = None
) -> list[dict[str, Any]]:
    """Fetch write (non-read-only) management events in the window.

    Filtering to ReadOnly=false server-side matters: without it the vast
    majority of returned events are Describe/List/Get calls that cannot have
    changed anything, and they would crowd out real changes within the page
    limit.
    """
    limit = max_events or config.MAX_EVENTS

    try:
        client = _client()
    except ImportError as exc:
        raise UpstreamUnavailableError(
            "boto3 is not installed, so live AWS mode is unavailable.",
            detail="Run 'pip install boto3', or use demo mode.",
        ) from exc

    events: list[dict[str, Any]] = []
    next_token: str | None = None

    try:
        while len(events) < limit:
            kwargs: dict[str, Any] = {
                "StartTime": start_time,
                "EndTime": end_time,
                "MaxResults": min(_PAGE_SIZE, limit - len(events)),
                "LookupAttributes": [
                    {"AttributeKey": "ReadOnly", "AttributeValue": "false"}
                ],
            }
            if next_token:
                kwargs["NextToken"] = next_token

            response = client.lookup_events(**kwargs)
            events.extend(response.get("Events", []))

            next_token = response.get("NextToken")
            if not next_token:
                break

    except Exception as exc:  # noqa: BLE001 - normalized into typed API errors below
        name = type(exc).__name__
        message = str(exc)

        if "AccessDenied" in message or "UnauthorizedOperation" in message:
            raise UpstreamPermissionError(
                "Not authorized to read CloudTrail events.",
                detail="The caller needs cloudtrail:LookupEvents. See infra/iam-policy.json.",
            ) from exc

        if "NoCredentialsError" in name or "Unable to locate credentials" in message:
            raise UpstreamUnavailableError(
                "No AWS credentials found.",
                detail="Configure credentials with 'aws configure', or use demo mode.",
            ) from exc

        if "EndpointConnectionError" in name or "ConnectTimeout" in name:
            raise UpstreamUnavailableError(
                "Could not reach the CloudTrail endpoint.",
                detail=f"Check network access and that region '{config.AWS_REGION}' is correct.",
            ) from exc

        log.exception("CloudTrail lookup failed")
        raise UpstreamUnavailableError(
            "CloudTrail request failed.", detail=message[:300]
        ) from exc

    return events[:limit]

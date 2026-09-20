"""AWS Lambda entry point behind API Gateway.

Supports both HTTP API (payload format 2.0) and REST API / ALB (format 1.0)
proxy shapes, because which one you get depends on how the API is created and
guessing wrong is a confusing failure at demo time.

All real work happens in app.api.dispatch, shared with the local dev server.
"""

import json
import logging

from app import api, config

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger("change-detective")

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": config.CORS_ALLOW_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}


def _extract_request(event: dict) -> tuple[str, str, dict]:
    """Return (method, path, query) for either payload format."""
    # HTTP API payload format 2.0
    http_ctx = (event.get("requestContext") or {}).get("http")
    if http_ctx:
        return (
            http_ctx.get("method", "GET"),
            http_ctx.get("path", "/"),
            event.get("queryStringParameters") or {},
        )

    # REST API / ALB payload format 1.0
    return (
        event.get("httpMethod", "GET"),
        event.get("path", "/"),
        event.get("queryStringParameters") or {},
    )


def _extract_body(event: dict) -> dict:
    raw = event.get("body")
    if not raw:
        return {}

    if event.get("isBase64Encoded"):
        import base64

        try:
            raw = base64.b64decode(raw).decode()
        except Exception:  # noqa: BLE001
            return {}

    if isinstance(raw, dict):
        return raw

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    return parsed if isinstance(parsed, dict) else {}


def _response(status: int, payload: dict) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(payload, default=str),
    }


def handler(event, context):  # noqa: ARG001 - context unused but required
    try:
        method, path, query = _extract_request(event)

        # Strip a stage prefix (e.g. /prod/health) so routes match either way.
        stage = ((event.get("requestContext") or {}).get("stage") or "").strip()
        if stage and stage != "$default" and path.startswith(f"/{stage}/"):
            path = path[len(stage) + 1 :]

        if method.upper() == "OPTIONS":
            return _response(204, {})

        body = _extract_body(event)
        status, payload = api.dispatch(method, path, query or {}, body)
        return _response(status, payload)

    except Exception:  # noqa: BLE001 - a Lambda must always return a valid response
        log.exception("Unhandled error in Lambda handler")
        return _response(500, {
            "error": {"code": "internal_error", "message": "An unexpected error occurred."}
        })

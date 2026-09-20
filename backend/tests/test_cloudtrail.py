"""Live CloudTrail path, exercised against a stubbed boto3 client.

This path has never run against a real account, so these tests stand in for
that: they assert the request shape, pagination, the LookupEvents response
format (where the useful payload is a JSON *string*), and that every failure
becomes an actionable message rather than a stack trace.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import cloudtrail, investigation, normalizer  # noqa: E402
from app.errors import UpstreamPermissionError, UpstreamUnavailableError  # noqa: E402

NOW = datetime.now(timezone.utc)


def _real_shaped_record(event_name="ModifyDBInstance", when=None):
    """A record shaped the way LookupEvents actually returns one."""
    inner = {
        "eventVersion": "1.09",
        "eventID": "11111111-2222-3333-4444-555555555555",
        "eventTime": (when or NOW).isoformat().replace("+00:00", "Z"),
        "eventName": event_name,
        "eventSource": "rds.amazonaws.com",
        "awsRegion": "us-east-1",
        "sourceIPAddress": "203.0.113.5",
        "userAgent": "aws-cli/2.36.49",
        "userIdentity": {
            "type": "AssumedRole",
            "arn": "arn:aws:sts::123456789012:assumed-role/deploy-role/session",
            "sessionContext": {"sessionIssuer": {"userName": "deploy-role"}},
        },
        "requestParameters": {"dBInstanceIdentifier": "prod-orders-db",
                              "applyImmediately": True},
    }
    return {
        "EventId": inner["eventID"],
        "EventName": event_name,
        "EventTime": when or NOW,
        "Username": "deploy-role",
        "Resources": [{"ResourceType": "AWS::RDS::DBInstance",
                       "ResourceName": "prod-orders-db"}],
        # The critical detail: a JSON *string*, not a dict.
        "CloudTrailEvent": json.dumps(inner),
    }


class FakeClient:
    def __init__(self, pages=None, error=None):
        self.pages = pages or [{"Events": []}]
        self.error = error
        self.calls = []

    def lookup_events(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.pages[min(len(self.calls) - 1, len(self.pages) - 1)]


def _with(client, fn):
    original = cloudtrail._client
    cloudtrail._client = lambda: client
    try:
        return fn()
    finally:
        cloudtrail._client = original


def test_requests_write_events_only():
    """Without the ReadOnly filter the page fills with Describe/List noise."""
    c = FakeClient(pages=[{"Events": [_real_shaped_record()]}])
    _with(c, lambda: cloudtrail.fetch_events(NOW - timedelta(minutes=30), NOW))
    kwargs = c.calls[0]
    assert kwargs["LookupAttributes"] == [
        {"AttributeKey": "ReadOnly", "AttributeValue": "false"}
    ]
    assert kwargs["StartTime"] < kwargs["EndTime"]
    assert kwargs["MaxResults"] <= 50, "LookupEvents caps page size at 50"


def test_paginates_until_token_exhausted():
    pages = [
        {"Events": [_real_shaped_record() for _ in range(50)], "NextToken": "t1"},
        {"Events": [_real_shaped_record() for _ in range(10)]},
    ]
    c = FakeClient(pages=pages)
    events = _with(c, lambda: cloudtrail.fetch_events(NOW - timedelta(hours=1), NOW))
    assert len(events) == 60
    assert c.calls[1].get("NextToken") == "t1", "second page must carry the token"


def test_respects_max_events():
    pages = [{"Events": [_real_shaped_record() for _ in range(50)], "NextToken": "t"}] * 6
    c = FakeClient(pages=pages)
    events = _with(c, lambda: cloudtrail.fetch_events(NOW - timedelta(hours=1), NOW, max_events=75))
    assert len(events) == 75


def test_real_record_shape_normalizes():
    """The payload arrives as a JSON string; the normalizer must unwrap it."""
    c = FakeClient(pages=[{"Events": [_real_shaped_record()]}])
    raw = _with(c, lambda: cloudtrail.fetch_events(NOW - timedelta(minutes=30), NOW))
    changes = normalizer.normalize_many(raw)
    assert len(changes) == 1
    ch = changes[0]
    assert ch.event_name == "ModifyDBInstance"
    assert ch.resource_id == "prod-orders-db"
    assert ch.actor == "deploy-role", "role name, not the session name"
    assert ch.aws_service == "RDS"
    assert ch.region == "us-east-1"


def test_errors_become_actionable_messages():
    cases = [
        ("AccessDeniedException: not authorized", UpstreamPermissionError, "cloudtrail:LookupEvents"),
        ("Unable to locate credentials", UpstreamUnavailableError, "aws configure"),
    ]
    for message, expected, hint in cases:
        c = FakeClient(error=Exception(message))
        try:
            _with(c, lambda: cloudtrail.fetch_events(NOW - timedelta(minutes=5), NOW))
            raise AssertionError(f"{message!r} should have raised")
        except expected as exc:
            blob = (exc.message + ' ' + (exc.detail or '')).lower()
            assert hint.lower() in blob, f"{message!r} -> unhelpful: {blob}"


def test_empty_account_is_not_an_error():
    """A quiet account returns nothing; that is a valid result, not a failure."""
    c = FakeClient(pages=[{"Events": []}])
    events = _with(c, lambda: cloudtrail.fetch_events(NOW - timedelta(minutes=30), NOW))
    assert events == []


def test_live_mode_end_to_end_through_investigate():
    # Live AWS is gated behind IMPACT_GUARD_DATA_MODE so the public demo cannot
    # read the deployment account. This test is about the CloudTrail path, so
    # it opts in explicitly.
    from app import config as _cfg
    _original = _cfg.LIVE_AWS_ALLOWED
    _cfg.LIVE_AWS_ALLOWED = True
    try:
        """The whole pipeline on live-shaped data, with Bedrock switched off."""
        when = NOW - timedelta(minutes=3)
        c = FakeClient(pages=[{"Events": [
            _real_shaped_record("ModifyDBInstance", when),
            _real_shaped_record("AuthorizeSecurityGroupIngress", NOW - timedelta(minutes=8)),
        ]}])
        result = _with(c, lambda: investigation.investigate(
            NOW.isoformat().replace("+00:00", "Z"), 30, "Checkout slow", "aws", explain=False))

        assert result["data_source"] == "aws"
        assert result["stats"]["total"] == 2
        assert result["changes"][0]["narrative"]["plain"], "narrative must work on live data too"
        assert result["briefing"]["headline"]
    finally:
        _cfg.LIVE_AWS_ALLOWED = _original



def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t(); print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1; print(f"  FAIL  {t.__name__}: {e}")
        except Exception as e:
            failed += 1; print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

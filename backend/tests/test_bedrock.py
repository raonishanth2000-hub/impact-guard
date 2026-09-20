"""Bedrock integration tests using a stubbed client.

The real Bedrock path cannot be exercised without AWS credentials and model
access, so these tests inject a fake client to cover the branches that matter:
response parsing, malformed output, and each error-to-hint mapping.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import bedrock, demo_data, normalizer, scoring  # noqa: E402

INCIDENT = datetime(2026, 9, 19, 10, 42, tzinfo=timezone.utc)
INCIDENT_ISO = INCIDENT.isoformat().replace("+00:00", "Z")


def _scored():
    raw = demo_data.fetch_demo_events(INCIDENT - timedelta(minutes=30), INCIDENT, INCIDENT)
    return scoring.score_and_rank(normalizer.normalize_many(raw), INCIDENT, 30)[:5]


class FakeClient:
    """Stands in for boto3's bedrock-runtime client."""

    def __init__(self, text=None, error=None):
        self._text = text
        self._error = error
        self.last_kwargs = None

    def converse(self, **kwargs):
        self.last_kwargs = kwargs
        if self._error:
            raise self._error
        return {"output": {"message": {"content": [{"text": self._text}]}}}


def _with_client(client, fn, availability=None):
    """Run fn with the Bedrock runtime stubbed.

    The control-plane client is stubbed too: the error path now asks Bedrock
    which precondition is failing, and a unit test must never reach the network.
    Pass `availability` to simulate that answer.
    """
    original, original_ctl = bedrock._client, bedrock._control_client

    class _Ctl:
        def get_foundation_model_availability(self, modelId):
            if availability is None:
                raise RuntimeError("control plane unavailable in tests")
            return availability

    bedrock._client = lambda: client
    bedrock._control_client = lambda: _Ctl()
    try:
        return fn()
    finally:
        bedrock._client, bedrock._control_client = original, original_ctl


GOOD_JSON = """{
  "summary": "Three changes landed shortly before the incident.",
  "per_change": [{"event_id": "x", "what_changed": "RDS modified",
                  "why_it_may_matter": "Database is on the request path.",
                  "relation_to_incident": "Potentially related; worth investigating."}],
  "recommended_checks": ["Check RDS latency.", "Check Lambda errors."]
}"""


def test_successful_response_is_parsed():
    client = FakeClient(text=GOOD_JSON)
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, "timeouts"))
    assert out["ai_available"] is True, out.get("ai_error")
    assert out["summary"].startswith("Three changes")
    assert len(out["recommended_checks"]) == 2
    assert out["model_id"]


def test_prompt_carries_structured_events_and_guardrails():
    client = FakeClient(text=GOOD_JSON)
    _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, "timeouts"))
    kwargs = client.last_kwargs

    system = kwargs["system"][0]["text"]
    assert "NEVER state or imply" in system, "causation guard must be in the system prompt"
    assert "potentially related" in system

    user = kwargs["messages"][0]["content"][0]["text"]
    assert "prod-orders-db" in user, "scored events must reach the model"
    assert "rule_based_reasons" in user, "deterministic reasons must be supplied"
    assert kwargs["inferenceConfig"]["maxTokens"] > 0


def test_code_fenced_json_is_parsed():
    client = FakeClient(text=f"```json\n{GOOD_JSON}\n```")
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    assert out["ai_available"] is True, out.get("ai_error")


def test_prose_wrapped_json_is_recovered():
    client = FakeClient(text=f"Sure, here you go:\n{GOOD_JSON}\nHope that helps.")
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    assert out["ai_available"] is True, out.get("ai_error")


def test_unparseable_response_falls_back():
    client = FakeClient(text="I cannot help with that.")
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    assert out["ai_available"] is False
    assert "could not be parsed" in out["ai_error"]
    assert out["summary"], "fallback must still produce a summary"
    assert out["recommended_checks"], "fallback must still produce checks"


def test_access_denied_gives_actionable_hint():
    """An IAM denial names the permission; model-access is a separate case."""
    client = FakeClient(error=Exception("AccessDeniedException: not authorized to invoke"))
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    assert out["ai_available"] is False
    assert "Enable model access" in out["ai_error"]
    assert "bedrock:InvokeModel" in out["ai_error"]
    assert out["summary"]


def test_bad_model_id_gives_actionable_hint():
    client = FakeClient(error=Exception("ValidationException: model not found"))
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    assert out["ai_available"] is False
    assert "BEDROCK_MODEL_ID" in out["ai_error"]


def test_disabled_flag_skips_bedrock_entirely():
    original = bedrock.config.BEDROCK_ENABLED
    bedrock.config.BEDROCK_ENABLED = False
    try:
        client = FakeClient(text=GOOD_JSON)
        out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
        assert out["ai_available"] is False
        # Assert the stable contract, not the prose, so copy edits do not break
        # this. The previous version asserted "BEDROCK_ENABLED" appeared in the
        # message — prose, and the very thing the comment warns against. It is
        # also the opposite of what we now want: an environment variable name
        # is operator detail and should not reach a reader of the report.
        assert out["ai_status"] == bedrock.STATUS_NOT_CONFIGURED
        assert out["ai_error"], "the reader must be told why there is no model output"
        assert "BEDROCK_ENABLED" not in out["ai_error"], "leaks config into the UI"
        assert client.last_kwargs is None, "Bedrock must not be called when disabled"
    finally:
        bedrock.config.BEDROCK_ENABLED = original


def test_fallback_never_asserts_causation():
    """The deterministic text must stay as hedged as the AI text is required to be."""
    out = bedrock.fallback_explanation(_scored(), "timeouts")
    blob = " ".join([out["summary"]] + out["recommended_checks"]).lower()
    for banned in ("caused by", "was caused", "root cause is", "definitely", "because of this change"):
        assert banned not in blob, f"fallback used causal language: {banned}"


def test_ai_status_distinguishes_setup_from_failure():
    """"Not set up yet" and "set up but broken" must not be reported the same way.

    The UI styles them differently - a fresh clone with no AWS account is an
    expected state and must not render as a failure.
    """
    expected = {
        "Unable to locate credentials": bedrock.STATUS_NOT_CONFIGURED,
        "ExpiredToken: token has expired": bedrock.STATUS_NOT_CONFIGURED,
        "AccessDeniedException: not authorized": bedrock.STATUS_ERROR,
        "ValidationException: model not found": bedrock.STATUS_ERROR,
        "ThrottlingException: slow down": bedrock.STATUS_ERROR,
        "socket exploded": bedrock.STATUS_ERROR,
    }
    for message, status in expected.items():
        client = FakeClient(error=Exception(message))
        out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
        assert out["ai_status"] == status, f"{message!r} -> {out['ai_status']}"
        assert out["ai_available"] is False
        # Whatever went wrong, the deterministic analysis must still be complete.
        assert out["summary"] and out["recommended_checks"], message


def test_missing_credentials_message_is_actionable():
    client = FakeClient(error=Exception("Unable to locate credentials"))
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    assert "aws configure" in out["ai_error"]
    assert "Unable to locate credentials" not in out["ai_error"], \
        "raw boto3 text should be replaced with an instruction"


def test_success_and_no_data_statuses():
    client = FakeClient(text=GOOD_JSON)
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    assert out["ai_status"] == bedrock.STATUS_READY

    out = bedrock.explain([], INCIDENT_ISO, None)
    assert out["ai_status"] == bedrock.STATUS_NO_DATA


def test_regional_profile_derivation():
    """A bare model id must become the right inference profile for its region."""
    bare = "anthropic.claude-3-5-sonnet-20240620-v1:0"
    assert bedrock.regional_profile_id(bare, "ap-south-1") == f"apac.{bare}"
    assert bedrock.regional_profile_id(bare, "us-east-1") == f"us.{bare}"
    assert bedrock.regional_profile_id(bare, "eu-west-1") == f"eu.{bare}"
    # Already-prefixed ids are left alone, so we never double-prefix.
    assert bedrock.regional_profile_id(f"apac.{bare}", "ap-south-1") is None
    assert bedrock.regional_profile_id(f"global.{bare}", "us-east-1") is None


class ProfileAwareClient:
    """Refuses a bare id the way ap-south-1 does; accepts the profile form."""

    def __init__(self, text):
        self.text = text
        self.tried = []

    def converse(self, **kwargs):
        mid = kwargs["modelId"]
        self.tried.append(mid)
        if not mid.startswith(("apac.", "us.", "eu.", "global.")):
            raise Exception(
                "ValidationException: Invocation of model ID with on-demand "
                "throughput isn't supported. Retry your request with the ID or ARN "
                "of an inference profile that contains this model."
            )
        return {"output": {"message": {"content": [{"text": self.text}]}}}


def test_retries_bare_model_id_as_regional_profile():
    """The operator should not have to decode 'use an inference profile'."""
    original_region = bedrock.config.BEDROCK_REGION
    bedrock.config.BEDROCK_REGION = "ap-south-1"
    try:
        client = ProfileAwareClient(GOOD_JSON)
        out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
        assert out["ai_available"] is True, out.get("ai_error")
        assert len(client.tried) == 2, "should try the bare id, then the profile"
        assert client.tried[1].startswith("apac."), client.tried
        assert out["model_id"] == client.tried[1], "reports the id that actually worked"
    finally:
        bedrock.config.BEDROCK_REGION = original_region


def test_access_not_granted_is_not_reported_as_a_region_problem():
    """These have different fixes and were previously conflated."""
    client = FakeClient(error=Exception("ValidationException: Operation not allowed"))
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    msg = out["ai_error"]
    assert "Model access" in msg, msg
    assert "inference profile" not in msg, "wrong fix: this is an access problem"


def test_access_error_names_the_specific_failing_precondition():
    """'Operation not allowed' has three causes with three different fixes.

    Reporting the wrong one is what sent us to the console repeatedly for a
    problem that was never there, so each cause must be named distinctly.
    """
    client = FakeClient(error=Exception("ValidationException: Operation not allowed"))
    cases = {
        "agreement": (
            {"regionAvailability": "AVAILABLE",
             "entitlementAvailability": "AVAILABLE",
             "agreementAvailability": {"status": "NOT_AVAILABLE"}},
            "licence agreement",
        ),
        "entitlement": (
            {"regionAvailability": "AVAILABLE",
             "entitlementAvailability": "NOT_AVAILABLE",
             "agreementAvailability": {"status": "NOT_AVAILABLE"}},
            "not entitled",
        ),
        "region": (
            {"regionAvailability": "NOT_AVAILABLE",
             "entitlementAvailability": "AVAILABLE",
             "agreementAvailability": {"status": "AVAILABLE"}},
            "not offered",
        ),
    }
    for name, (availability, expected) in cases.items():
        out = _with_client(
            client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None),
            availability=availability,
        )
        assert expected in out["ai_error"], f"{name}: {out['ai_error']}"


def test_access_check_failure_still_yields_a_usable_hint():
    """The diagnostic is best effort; losing it must not blank the message."""
    client = FakeClient(error=Exception("ValidationException: Operation not allowed"))
    out = _with_client(client, lambda: bedrock.explain(_scored(), INCIDENT_ISO, None))
    assert out["ai_available"] is False
    assert len(out["ai_error"]) > 40, out["ai_error"]
    assert out["summary"], "the deterministic assessment must still be present"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {t.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

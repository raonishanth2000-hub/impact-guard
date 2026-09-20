"""Smoke tests for the investigation pipeline.

Runs with plain `python3 tests/test_smoke.py` (no pytest required) so the team
can check the build on a machine with nothing installed. pytest also picks them
up if it is available.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import api, demo_data, normalizer, scoring  # noqa: E402
from app.errors import ValidationError  # noqa: E402
from app.investigation import parse_incident_time, validate_lookback  # noqa: E402

INCIDENT = datetime(2026, 9, 19, 10, 42, tzinfo=timezone.utc)
WINDOW = 30


def _ranked():
    start = INCIDENT - timedelta(minutes=WINDOW)
    end = INCIDENT + timedelta(minutes=5)
    raw = demo_data.fetch_demo_events(start, end, INCIDENT)
    return scoring.score_and_rank(normalizer.normalize_many(raw), INCIDENT, WINDOW)


def test_demo_events_normalize():
    ranked = _ranked()
    assert len(ranked) == 11, f"expected 11 demo changes, got {len(ranked)}"
    assert all(s.change.actor != "unknown" for s in ranked), "every change must have an actor"
    assert all(s.change.aws_service for s in ranked), "every change must have a service"


def test_closest_production_change_ranks_first():
    """The RDS change 1 minute before the incident must outrank everything."""
    top = _ranked()[0]
    assert top.change.resource_id == "prod-orders-db", f"got {top.change.resource_id}"
    assert top.relevance == "HIGH"
    assert top.minutes_from_incident == -1.0


def test_security_group_resolves_to_readable_name():
    ranked = _ranked()
    sg = next(s for s in ranked if s.change.event_name == "AuthorizeSecurityGroupIngress")
    assert sg.change.resource_id == "prod-web-security-group", sg.change.resource_id


def test_post_incident_change_never_ranks_high():
    ranked = _ranked()
    after = [s for s in ranked if s.minutes_from_incident > 0]
    assert after, "demo scenario should contain a post-incident change"
    for s in after:
        assert s.relevance != "HIGH", "post-incident changes must not be HIGH"
        assert any("after the incident" in r for r in s.reasons)


def test_failed_call_is_damped():
    ranked = _ranked()
    failed = next(s for s in ranked if s.change.error_code)
    assert failed.relevance == "LOW", f"failed call scored {failed.score}"
    assert any("failed" in r.lower() for r in failed.reasons)


def test_malformed_record_does_not_break_batch():
    records = [{"garbage": True}, {"eventName": None}, "not-a-dict"]
    out = normalizer.normalize_many(records)  # type: ignore[arg-type]
    assert isinstance(out, list), "normalize_many must never raise on bad input"


def test_input_validation():
    for bad in ("not-a-date", "2026-13-45T99:99:99"):
        try:
            parse_incident_time(bad)
            raise AssertionError(f"{bad!r} should have been rejected")
        except ValidationError:
            pass

    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    try:
        parse_incident_time(future)
        raise AssertionError("future incident_time should have been rejected")
    except ValidationError:
        pass

    for bad in (0, -5, 99999, "abc"):
        try:
            validate_lookback(bad)
            raise AssertionError(f"lookback {bad!r} should have been rejected")
        except ValidationError:
            pass

    # An offset-aware time must be honoured, not reinterpreted: 10:42 +05:30 is 05:12 UTC.
    parsed = parse_incident_time("2026-09-19T10:42:00+05:30").astimezone(timezone.utc)
    assert (parsed.hour, parsed.minute) == (5, 12), parsed.isoformat()

    # A naive timestamp is treated as UTC rather than server local time.
    # Uses a past date so the future-guard is not what is under test here.
    naive = parse_incident_time("2026-09-18T10:42:00")
    assert naive.utcoffset() == timedelta(0)
    assert naive.hour == 10


def test_api_contract():
    status, body = api.dispatch("GET", "/health", {}, {})
    assert status == 200 and body["status"] == "ok"

    status, body = api.dispatch("POST", "/investigate", {}, {
        "incident_time": "2026-09-19T10:42:00+05:30",
        "lookback_minutes": 30,
        "description": "Checkout requests started timing out",
        "mode": "demo",
    })
    assert status == 200
    for key in ("incident", "stats", "timeline", "changes", "explanation", "data_source"):
        assert key in body, f"missing '{key}' in investigate response"

    # Explanation must be present and usable even with Bedrock unavailable.
    assert body["explanation"]["summary"]
    assert body["explanation"]["recommended_checks"]
    assert len(set(body["explanation"]["recommended_checks"])) == \
        len(body["explanation"]["recommended_checks"]), "checks must be deduped"

    # Timeline must contain exactly one incident marker, correctly positioned.
    markers = [e for e in body["timeline"] if e["type"] == "incident"]
    assert len(markers) == 1
    times = [e["time"] for e in body["timeline"]]
    assert times == sorted(times), "timeline must be chronological"

    status, body = api.dispatch("GET", "/nope", {}, {})
    assert status == 404

    status, body = api.dispatch("POST", "/investigate", {}, {"mode": "banana"})
    assert status == 400 and body["error"]["code"] == "validation_error"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"  PASS  {test.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL  {test.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  ERROR {test.__name__}: {type(exc).__name__}: {exc}")

    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())


def test_dotenv_parser_handles_a_malformed_file():
    """A broken .env must not stop the service booting."""
    from app import config as cfg

    parsed = cfg._parse_env_file(
        "not a pair\n\n# comment\nGOOD_KEY = spaced \nQUOTED=\"v\"\n=novalue\n"
    )
    assert parsed == {"GOOD_KEY": "spaced", "QUOTED": "v"}


def test_dotenv_loader_does_not_override_real_environment(tmp_path, monkeypatch):
    """A shell export must beat the file, or deployment cannot override a default."""
    import os
    from app import config as cfg

    env = tmp_path / ".env"
    env.write_text("DATA_SOURCE=aws\nSOME_UNSET_KEY=from_file\n")
    monkeypatch.setenv("DATA_SOURCE", "demo")     # already set: file must not win
    monkeypatch.delenv("SOME_UNSET_KEY", raising=False)

    cfg._load_dotenv(paths=(env,))                # explicit, no cwd guessing
    assert os.environ["DATA_SOURCE"] == "demo", "the file overrode a real env var"
    assert os.environ["SOME_UNSET_KEY"] == "from_file", "the file was not read"


def test_dotenv_loader_ignores_a_missing_file():
    """A project with no .env is the normal case, not an error."""
    from app import config as cfg

    cfg._load_dotenv(paths=("/nonexistent/.env",))   # must not raise

"""Tests for the plain-language narrative layer.

The point of these is the honesty rule: CloudTrail records the request, not a
diff, so a before-state may only be stated when the operation's own meaning
implies it. Everything else must be flagged as unrecorded.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import catalog, demo_data, narrative, normalizer, scoring  # noqa: E402

INCIDENT = datetime(2026, 9, 19, 10, 42, tzinfo=timezone.utc)


def _changes():
    raw = demo_data.fetch_demo_events(INCIDENT - timedelta(minutes=30), INCIDENT + timedelta(minutes=5), INCIDENT)
    return normalizer.normalize_many(raw)


def _scored():
    return scoring.score_and_rank(_changes(), INCIDENT, 30)


def test_every_supported_event_has_a_narrative():
    missing = [e for e in catalog.supported_events() if e not in narrative.BUILDERS]
    assert not missing, f"no plain-language narrative for: {missing}"


def test_narrative_has_all_sections():
    for c in _changes():
        n = narrative.describe(c)
        for key in ('plain', 'before', 'after', 'before_known', 'risks', 'checklist',
                    'recommend', 'actor_plain'):
            assert key in n, f"{c.event_name} missing '{key}'"
        assert n['risks'] and n['checklist'], f"{c.event_name} has empty guidance"


def test_before_state_claimed_only_when_the_operation_implies_it():
    """The core honesty rule.

    Lifecycle and access operations imply their prior state; configuration
    writes do not, because CloudTrail carries only the new value.
    """
    derivable = {
        'AuthorizeSecurityGroupIngress', 'RevokeSecurityGroupIngress',
        'RunInstances', 'StopInstances', 'TerminateInstances',
        'DeleteBucketPolicy', 'UpdateFunctionCode',
    }
    unrecorded = {
        'ModifyDBInstance', 'UpdateFunctionConfiguration',
        'UpdateAutoScalingGroup', 'PutBucketPolicy',
    }

    for c in _changes():
        if c.error_code:
            continue  # refused calls are handled separately
        n = narrative.describe(c)
        if c.event_name in derivable:
            assert n['before_known'] is True, f"{c.event_name} should derive its before-state"
        elif c.event_name in unrecorded:
            assert n['before_known'] is False, (
                f"{c.event_name} claims a before-state, but CloudTrail does not record one"
            )


def test_unrecorded_before_states_say_so():
    for c in _changes():
        n = narrative.describe(c)
        if not n['before_known']:
            text = (n['before'] + ' ' + n['after']).lower()
            # It must not assert a specific prior value it cannot know.
            assert 'was set to' not in text and 'previously set to' not in text, c.event_name


def test_refused_calls_report_no_change():
    failed = [c for c in _changes() if c.error_code]
    assert failed, "demo scenario should contain a refused call"
    for c in failed:
        n = narrative.describe(c)
        assert 'nothing changed' in n['plain'].lower()
        assert n['after'].lower().startswith('unchanged')


def test_plain_language_avoids_api_vocabulary():
    """Plain text is for someone who does not work in the console."""
    jargon = ['CloudTrail', 'IAM', 'ingress', 'API call', 'principal', 'ARN',
              'eventName', 'requestParameters']
    for c in _changes():
        n = narrative.describe(c)
        blob = ' '.join([n['plain'], n['before'], n['after'], n['recommend']])
        for term in jargon:
            assert term.lower() not in blob.lower(), f"{c.event_name}: '{term}' in plain text"


def test_narrative_never_asserts_cause():
    banned = ['caused the', 'was caused by', 'root cause', 'this broke', 'responsible for the outage']
    for c in _changes():
        n = narrative.describe(c)
        blob = ' '.join([n['plain'], n['before'], n['after'], n['recommend']] + n['risks']).lower()
        for term in banned:
            assert term not in blob, f"{c.event_name}: causal claim '{term}'"


def test_briefing_separates_certain_from_uncertain():
    scored = _scored()
    stats = {'total': len(scored), 'high': 3, 'medium': 4, 'low': 4,
             'before_incident': sum(1 for s in scored if s.occurred_before_incident)}
    b = narrative.briefing(scored, {'description': 'Checkout requests started timing out',
                                    'lookback_minutes': 30}, stats)
    for key in ('headline', 'confidence', 'certain', 'uncertain', 'next'):
        assert key in b and b[key], f"briefing missing '{key}'"
    # It must explicitly disclaim causation for a non-technical reader.
    joined = ' '.join(b['uncertain']).lower()
    assert 'proves' in joined or 'not a conclusion' in joined


def test_briefing_handles_no_candidates():
    b = narrative.briefing([], {'description': 'Something broke', 'lookback_minutes': 15},
                           {'total': 0, 'high': 0, 'medium': 0, 'low': 0, 'before_incident': 0})
    assert 'nothing was changed' in b['headline'].lower()


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
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


if __name__ == '__main__':
    sys.exit(main())

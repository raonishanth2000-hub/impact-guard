"""Amazon Bedrock integration - explanation only, never detection.

Bedrock receives events that the deterministic engine has ALREADY selected and
scored. Its job is to explain them in operator language and propose next checks.
It does not rank, filter, or decide what is relevant.

Two hard rules:
  1. The model is told, repeatedly and structurally, not to assert causation.
  2. Any failure here is non-fatal. `explain()` always returns a usable result;
     on error it falls back to a deterministic explanation built from the
     scoring engine's own reasons.

The model is selected entirely through environment variables, so swapping models
(or providers) needs no code change. We use the Converse API because its request
shape is identical across Bedrock model families.
"""

import json
import logging
from typing import Any

from . import config
from .models import ScoredChange

log = logging.getLogger(__name__)

# Why the explanation is not model-generated. The UI renders "not yet set up"
# differently from "set up but broken" - a fresh clone with no AWS account is an
# expected state, not a failure, and should not look like one.
STATUS_READY = "ready"              # Bedrock answered
STATUS_NOT_CONFIGURED = "not_configured"  # nothing to fix yet: no SDK, no creds, turned off
STATUS_ERROR = "error"              # genuinely wrong: denied, bad model, bad response
STATUS_NO_DATA = "no_data"          # nothing to explain

SYSTEM_PROMPT = """\
You are an AWS incident investigation assistant. You help engineers understand \
which infrastructure changes are worth investigating after an incident.

CRITICAL RULES - these override everything else:
1. NEVER state or imply that a change definitely caused the incident. You are \
looking at timing correlation only, never proof of causation.
2. Use hedged language at all times: "potentially related", "worth investigating", \
"occurred shortly before the incident", "possible contributing change", \
"may be relevant".
3. NEVER invent AWS events, resources, timestamps, metrics or actors. Describe \
only what appears in the supplied data.
4. If the evidence is weak, say so plainly. "No strong candidate stands out" is a \
valid and useful answer.
5. Prefer concrete, checkable next steps (a specific metric, log group or console \
page) over generic advice.

Respond with a single JSON object and nothing else:
{
  "summary": "2-3 sentences on what changed in this window and what stands out.",
  "per_change": [
    {
      "event_id": "<the event_id exactly as supplied>",
      "what_changed": "One plain-language sentence.",
      "why_it_may_matter": "One or two sentences on the operational risk.",
      "relation_to_incident": "Hedged statement about possible relevance."
    }
  ],
  "recommended_checks": [
    "Specific, actionable investigation step.",
    "Another one."
  ]
}"""



# Several regions refuse bare foundation-model ids on demand and require a
# region-scoped inference profile instead. Rather than make that the operator's
# problem, derive the profile id from the region and retry once.
_PROFILE_PREFIX = {"us": "us.", "eu": "eu.", "ap": "apac.", "ca": "us.", "sa": "us."}


def regional_profile_id(model_id: str, region: str) -> str | None:
    """Return the inference-profile form of a bare model id, or None."""
    if not model_id or "." not in model_id:
        return None
    # Already prefixed (us. / eu. / apac. / global.)
    if model_id.split(".", 1)[0] in {"us", "eu", "apac", "global"}:
        return None
    prefix = _PROFILE_PREFIX.get((region or "").split("-")[0])
    return f"{prefix}{model_id}" if prefix else None


def _build_user_prompt(
    scored: list[ScoredChange], incident_time_iso: str, description: str | None
) -> str:
    payload = {
        "incident_time": incident_time_iso,
        "incident_description": description or "(none provided)",
        "changes": [
            {
                "event_id": s.change.event_id,
                "event_name": s.change.event_name,
                "aws_service": s.change.aws_service,
                "summary": s.change.action_summary,
                "resource": s.change.resource_id,
                "resource_type": s.change.resource_type,
                "changed_by": s.change.actor,
                "event_time": s.change.to_dict()["event_time"],
                "minutes_from_incident": round(s.minutes_from_incident, 1),
                "occurred_before_incident": s.occurred_before_incident,
                "relevance": s.relevance,
                "score": s.score,
                "rule_based_reasons": s.reasons,
                "change_detail": s.change.change_detail,
                "failed": bool(s.change.error_code),
            }
            for s in scored
        ],
    }
    return (
        "Here is an incident and the AWS changes that a deterministic rules engine "
        "selected as most worth reviewing. Explain them for the on-call engineer.\n\n"
        f"{json.dumps(payload, indent=2, default=str)}"
    )


def _extract_json(text: str) -> dict[str, Any] | None:
    """Pull a JSON object out of a model response, tolerating prose or code fences."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text[3:]
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None



# Bedrock refuses with a single opaque string for three different reasons. The
# control-plane availability call reports them separately, which turns a dead
# end into one specific instruction.
ACCESS_HINTS = {
    "agreement": (
        "The model licence agreement has not been accepted for this account. The "
        "console's old 'Model access' page has been retired; access is now granted "
        "in two steps - submit the use-case form, then accept the model agreement. "
        "Run: python3 tools/check_bedrock_access.py --region {region} "
        "for the exact commands and current status."
    ),
    "entitlementAvailability": (
        "This account is not entitled to the model, which is usually billing: the "
        "account must be fully activated with a valid payment method. A newly created "
        "account can take a few hours to become eligible."
    ),
    "regionAvailability": (
        "The configured model is not offered in {region}. Set BEDROCK_REGION to a "
        "region that has it, or set BEDROCK_MODEL_ID to one this region offers."
    ),
}


def access_blocker(model_id: str) -> str | None:
    """Return which precondition is failing, or None if it cannot be determined.

    Best effort by design: if this diagnostic call fails for any reason we fall
    back to the commonest cause rather than masking the original error.
    """
    try:
        # The availability API wants the bare model id, not a regional profile.
        bare = model_id.split(".", 1)[1] if model_id.split(".", 1)[0] in (
            "apac", "us", "eu", "global"
        ) else model_id
        a = _control_client().get_foundation_model_availability(modelId=bare)
    except Exception:
        return None

    if a.get("regionAvailability") != "AVAILABLE":
        return "regionAvailability"
    if a.get("entitlementAvailability") != "AVAILABLE":
        return "entitlementAvailability"
    if a.get("agreementAvailability", {}).get("status") != "AVAILABLE":
        return "agreement"
    return None

def fallback_explanation(scored: list[ScoredChange], description: str | None) -> dict[str, Any]:
    """Deterministic explanation used whenever Bedrock is unavailable.

    Built entirely from the scoring engine's reasons, so the dashboard stays
    genuinely useful with AI switched off. This is the default path until a
    Bedrock model is enabled on the account.
    """
    if not scored:
        return {
            "summary": "No AWS changes were found in this window, so there is nothing "
                       "to correlate with the incident.",
            "per_change": [],
            "recommended_checks": [
                "Widen the lookback window and investigate again.",
                "Confirm CloudTrail is enabled and delivering management events in this region.",
                "Consider causes outside the AWS control plane, such as an application "
                "deployment, a traffic spike, or a third-party dependency.",
            ],
        }

    top = scored[0]
    focus = [s for s in scored if s.relevance in ("HIGH", "MEDIUM") and s.occurred_before_incident]

    if focus:
        lead = (
            f"{len(focus)} change(s) in this window occurred before the incident and are "
            f"worth investigating. The highest-ranked is \"{top.change.action_summary}\" "
            f"by {top.change.actor}, {abs(top.minutes_from_incident):.0f} minute(s) before "
            f"the incident. This is a timing correlation only, not evidence of causation."
        )
    else:
        lead = (
            "No change in this window stands out as a strong candidate. The changes found "
            "either occurred after the incident began or affect resources unrelated to the "
            "reported symptom."
        )

    per_change = [
        {
            "event_id": s.change.event_id,
            "what_changed": s.change.action_summary,
            "why_it_may_matter": (
                f"{s.change.event_name} affects {s.change.resource_type} "
                f"'{s.change.resource_id}' in {s.change.aws_service}."
            ),
            "relation_to_incident": (
                "; ".join(s.reasons) if s.reasons else "No strong relevance signals."
            ),
        }
        for s in scored[:5]
    ]

    # Ordered dedupe: two changes to the same resource would otherwise produce
    # the same check twice (e.g. an ingress rule added then revoked).
    checks: list[str] = []

    def add_check(text: str) -> None:
        if text not in checks:
            checks.append(text)

    for s in scored[:4]:
        svc = s.change.aws_service
        res = s.change.resource_id
        if svc == "RDS":
            add_check(f"Check CloudWatch connection count, CPU and read/write latency for {res}.")
        elif svc == "Lambda":
            add_check(f"Check the error rate, duration and throttle count for {res}.")
        elif svc == "EC2" and s.change.category == "security":
            add_check(f"Review the current inbound rules on {res} against what they were before.")
        elif svc == "EC2":
            add_check(f"Confirm {res} was expected to change state, and check target group health.")
        elif svc == "S3":
            add_check(f"Verify the bucket policy on {res} still permits the required principals.")
        elif svc == "AutoScaling":
            add_check(f"Check whether {res} capacity matches current demand and instances are healthy.")
        else:
            add_check(f"Review the {s.change.event_name} call against {res} and confirm it was intended.")

    add_check("Correlate these change timestamps with your application error logs and deployment history.")
    return {"summary": lead, "per_change": per_change, "recommended_checks": checks[:6]}


def _session():
    """A boto3 session for Bedrock, honouring BEDROCK_PROFILE when set.

    boto3 is imported lazily so demo mode runs on a machine with no AWS SDK
    installed at all.
    """
    import boto3  # noqa: PLC0415 - intentional lazy import

    if config.BEDROCK_PROFILE:
        return boto3.Session(profile_name=config.BEDROCK_PROFILE)
    return boto3.Session()


def _client():
    """Create the Bedrock runtime client."""
    return _session().client("bedrock-runtime", region_name=config.BEDROCK_REGION)


def _control_client():
    """Bedrock control-plane client, used only for availability diagnostics."""
    return _session().client("bedrock", region_name=config.BEDROCK_REGION)


def explain(
    scored: list[ScoredChange], incident_time_iso: str, description: str | None
) -> dict[str, Any]:
    """Explain the supplied changes. Always returns a usable dict.

    The returned dict carries `ai_available` and, when AI is off, `ai_error`
    describing why, so the UI can be honest about where the text came from.
    """
    if not config.BEDROCK_ENABLED:
        out = fallback_explanation(scored, description)
        out["ai_available"] = False
        out["ai_status"] = STATUS_NOT_CONFIGURED
        out["ai_error"] = (
            "Ranking, scoring and recommended checks are produced by the "
            "deterministic engine and are unaffected. Model explanations are "
            "off (BEDROCK_ENABLED=false)."
        )
        return out

    if not scored:
        out = fallback_explanation(scored, description)
        out["ai_available"] = False
        out["ai_status"] = STATUS_NO_DATA
        out["ai_error"] = "No changes in this window to explain."
        return out

    try:
        client = _client()

        def call(mid):
            return client.converse(
                modelId=mid,
                system=[{"text": SYSTEM_PROMPT}],
                messages=[{
                    "role": "user",
                    "content": [
                        {"text": _build_user_prompt(scored, incident_time_iso, description)}
                    ],
                }],
                inferenceConfig={
                    "maxTokens": config.BEDROCK_MAX_TOKENS,
                    "temperature": config.BEDROCK_TEMPERATURE,
                },
            )

        model_id = config.BEDROCK_MODEL_ID
        try:
            response = call(model_id)
        except Exception as first:
            # "on-demand throughput isn't supported" means the region wants an
            # inference profile rather than a bare model id. Derive it and retry
            # once, instead of making the operator decode that message.
            profile = regional_profile_id(model_id, config.BEDROCK_REGION)
            if not (profile and "on-demand throughput" in str(first)):
                raise
            log.info("Retrying Bedrock with inference profile %s", profile)
            model_id = profile
            response = call(model_id)

        text = "".join(
            block.get("text", "")
            for block in response["output"]["message"]["content"]
        )
        parsed = _extract_json(text)

        if not parsed or "summary" not in parsed:
            log.warning("Bedrock returned unparseable output; using fallback.")
            out = fallback_explanation(scored, description)
            out["ai_available"] = False
            out["ai_status"] = STATUS_ERROR
            out["ai_error"] = "The model response could not be parsed as JSON."
            return out

        parsed.setdefault("per_change", [])
        parsed.setdefault("recommended_checks", [])
        parsed["ai_available"] = True
        parsed["ai_status"] = STATUS_READY
        parsed["model_id"] = model_id
        return parsed

    except ImportError:
        out = fallback_explanation(scored, description)
        out["ai_available"] = False
        out["ai_status"] = STATUS_NOT_CONFIGURED
        out["ai_error"] = (
            "The AWS SDK is not installed, so Bedrock was not called. "
            "Run: pip install boto3"
        )
        return out
    except Exception as exc:  # noqa: BLE001 - AI failure must never fail the investigation
        message = str(exc)
        name = type(exc).__name__

        # Ordered most-likely-first. Missing credentials is what a new user hits
        # before anything else, so it gets the clearest instruction rather than
        # falling through to a raw boto3 string.
        if "Unable to locate credentials" in message or "NoCredentials" in name:
            status = STATUS_NOT_CONFIGURED
            hint = (
                "No AWS credentials found, so Bedrock was not called. "
                "Run 'aws configure' (or set AWS_ACCESS_KEY_ID and "
                "AWS_SECRET_ACCESS_KEY), then investigate again."
            )
        elif "ExpiredToken" in message or "InvalidClientTokenId" in message:
            status = STATUS_NOT_CONFIGURED
            hint = (
                "Your AWS credentials have expired. Refresh them "
                "(for SSO: 'aws sso login'), then investigate again."
            )
        elif "Operation not allowed" in message:
            # Bedrock's wording for "this account never requested this model".
            # Previously reported as a region/profile problem, which sent people
            # to entirely the wrong fix.
            status = STATUS_ERROR
            # "Operation not allowed" covers three unrelated causes, so name the
            # one actually failing instead of listing all of them. The check is a
            # control-plane read, not an inference call, so it costs nothing.
            cause = access_blocker(config.BEDROCK_MODEL_ID)
            hint = (
                ACCESS_HINTS.get(cause) or ACCESS_HINTS["agreement"]
            ).format(region=config.BEDROCK_REGION)
        elif "AccessDenied" in message or "not authorized" in message:
            # A distinct cause: the model may be enabled, but the caller's IAM
            # policy does not permit invoking it.
            status = STATUS_ERROR
            hint = (
                "The caller is not permitted to invoke Bedrock. Enable model access "
                f"for '{config.BEDROCK_MODEL_ID}' under Bedrock > Model access "
                f"(region {config.BEDROCK_REGION}), and confirm the IAM policy allows "
                "bedrock:InvokeModel. See infra/iam-policy.json."
            )
        elif "ValidationException" in message or "ResourceNotFound" in message:
            status = STATUS_ERROR
            hint = (
                f"Model '{config.BEDROCK_MODEL_ID}' is not available in "
                f"{config.BEDROCK_REGION}. Set BEDROCK_MODEL_ID to a model enabled in "
                "your account, or use a region-prefixed inference profile such as "
                "'apac.' or 'us.'."
            )
        elif "ThrottlingException" in message or "TooManyRequests" in message:
            status = STATUS_ERROR
            hint = "Bedrock throttled the request. Wait a moment and investigate again."
        elif "EndpointConnectionError" in name or "ConnectTimeout" in name:
            status = STATUS_ERROR
            hint = (
                f"Could not reach Bedrock in {config.BEDROCK_REGION}. "
                "Check network access and that the region is correct."
            )
        else:
            status = STATUS_ERROR
            hint = f"Bedrock call failed: {message}"

        log.warning("Bedrock unavailable, using deterministic fallback: %s", message)
        out = fallback_explanation(scored, description)
        out["ai_available"] = False
        out["ai_status"] = status
        out["ai_error"] = hint
        return out


def credential_status() -> dict:
    """Report whether AWS credentials resolve, and by which method.

    Local only — this inspects boto3's provider chain and makes no network call,
    so /health stays instant and needs no extra IAM permission. It is the first
    thing to check when wiring up someone else's account: it distinguishes "no
    credentials at all" from "credentials present but the wrong ones", which
    otherwise look identical from the UI.

    Never returns the secret. The access key id is truncated, because even that
    identifies an account.
    """
    try:
        import boto3  # noqa: PLC0415 - lazy, demo mode needs no SDK
    except ImportError:
        return {
            "resolved": False,
            "method": None,
            "detail": "The AWS SDK is not installed. Run: pip install boto3",
        }

    try:
        session = boto3.Session()
        creds = session.get_credentials()
        if not creds:
            return {
                "resolved": False,
                "method": None,
                "detail": (
                    "No credentials found. Set AWS_ACCESS_KEY_ID and "
                    "AWS_SECRET_ACCESS_KEY, or run 'aws configure', or set "
                    "AWS_PROFILE to a configured profile."
                ),
            }

        frozen = creds.get_frozen_credentials()
        return {
            "resolved": True,
            # e.g. 'env', 'shared-credentials-file', 'assume-role', 'sso'
            "method": creds.method,
            "access_key_hint": (frozen.access_key or "")[:4] + "…",
            "temporary": bool(frozen.token),
            "profile": session.profile_name,
            "session_region": session.region_name,
            "detail": None,
        }
    except Exception as exc:  # noqa: BLE001 - diagnostics must never fail health
        return {"resolved": False, "method": None, "detail": f"Could not resolve: {exc}"[:200]}

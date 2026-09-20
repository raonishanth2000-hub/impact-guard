"""Configuration, read from the environment.

A .env file beside the project root is loaded first, if present. Real
environment variables always win, so a shell export overrides the file and
deployment (Lambda) needs no file at all.

No secrets belong in this module, and AWS credentials are never read here:
boto3 resolves those from the standard provider chain.
"""

import os
from pathlib import Path


def _parse_env_file(text: str) -> dict[str, str]:
    """Parse KEY=value lines. Pure, so it can be tested without touching disk.

    Blank lines, comments and anything without an '=' are skipped rather than
    raising: a malformed .env must never stop the service booting.
    """
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key:
            out[key] = value.strip().strip("'\"")
    return out


def _load_dotenv(paths=None) -> None:
    """Load the first .env found, from the project root then the cwd.

    Deliberately not python-dotenv: demo mode is meant to run on a machine with
    nothing installed. Anything already in os.environ is left alone, so a shell
    export and a Lambda environment both beat the file.
    """
    if paths is None:
        paths = (Path(__file__).resolve().parents[2] / ".env", Path.cwd() / ".env")

    for path in paths:
        try:
            if not Path(path).is_file():
                continue
            text = Path(path).read_text()
        except OSError:
            continue
        for key, value in _parse_env_file(text).items():
            os.environ.setdefault(key, value)
        return


_load_dotenv()

DATA_SOURCE = os.environ.get("DATA_SOURCE", "demo").strip().lower()

# The hosted demo is open to the internet, so it must not be able to read the
# deployment account's CloudTrail on request. "demo" locks the API to generated
# events regardless of what a caller asks for; "live" allows the per-request
# override that local and private deployments rely on. Defaults to the safe one.
DATA_MODE = os.environ.get("IMPACT_GUARD_DATA_MODE", "demo").strip().lower()
if DATA_MODE not in ("demo", "live"):
    DATA_MODE = "demo"
LIVE_AWS_ALLOWED = DATA_MODE == "live"

# Anything reachable from the internet must not describe its own credentials.
# Lambda always sets this variable, so it identifies the hosted deployment
# without needing another flag that can drift out of step.
RUNNING_ON_LAMBDA = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
EXPOSE_CREDENTIAL_DIAGNOSTICS = not RUNNING_ON_LAMBDA

AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1").strip()

# Bedrock is configured purely through env vars so the model can be swapped
# without a code change. Region is separate because Bedrock model availability
# differs from the region your workload runs in.
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", AWS_REGION).strip()
# Bedrock may live in a different AWS account from the CloudTrail being read:
# model access is granted per account, so the account with the events is not
# always the account allowed to explain them. Empty means "same credentials as
# everything else", which is the normal case.
BEDROCK_PROFILE = os.environ.get("BEDROCK_PROFILE", "").strip()
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-5-20250929-v1:0"
).strip()
BEDROCK_MAX_TOKENS = int(os.environ.get("BEDROCK_MAX_TOKENS", "1400"))
BEDROCK_TEMPERATURE = float(os.environ.get("BEDROCK_TEMPERATURE", "0.2"))
BEDROCK_ENABLED = os.environ.get("BEDROCK_ENABLED", "true").strip().lower() != "false"

# Guard rails on user input.
MAX_LOOKBACK_MINUTES = int(os.environ.get("MAX_LOOKBACK_MINUTES", "360"))
MAX_EVENTS = int(os.environ.get("MAX_EVENTS", "200"))

# Number of top-scoring events handed to Bedrock. Keeps latency and cost bounded.
MAX_EVENTS_TO_EXPLAIN = int(os.environ.get("MAX_EVENTS_TO_EXPLAIN", "8"))

CORS_ALLOW_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", "*").strip()


def public_config() -> dict:
    """Safe-to-expose settings for the /health endpoint. No secrets."""
    return {
        "data_source": DATA_SOURCE,
        "data_mode": DATA_MODE,
        "live_aws_allowed": LIVE_AWS_ALLOWED,
        "aws_region": AWS_REGION,
        "bedrock_region": BEDROCK_REGION,
        "bedrock_profile": BEDROCK_PROFILE or None,
        "bedrock_model_id": BEDROCK_MODEL_ID,
        "bedrock_enabled": BEDROCK_ENABLED,
        "max_lookback_minutes": MAX_LOOKBACK_MINUTES,
    }

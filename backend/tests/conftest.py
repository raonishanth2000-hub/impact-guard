"""Test environment.

The suite must not depend on whatever .env happens to sit in the working tree.
app.config loads that file at import time and never overrides variables that
are already set, so setting the suite's expectations here — before app.config
is first imported — neutralises any local .env.

Without this, a developer running with BEDROCK_ENABLED=false silently skips
thirteen Bedrock tests' real code path and they fail for reasons that have
nothing to do with the change under test.
"""

import os

_TEST_ENV = {
    "DATA_SOURCE": "demo",
    "AWS_REGION": "ap-south-1",
    "BEDROCK_ENABLED": "true",
    "BEDROCK_REGION": "ap-south-1",
    "BEDROCK_PROFILE": "",
    "BEDROCK_MODEL_ID": "anthropic.claude-3-5-sonnet-20240620-v1:0",
}

for _key, _value in _TEST_ENV.items():
    os.environ[_key] = _value

#!/usr/bin/env python3
"""Deploy the investigation API to Lambda behind an HTTP API Gateway.

Idempotent: safe to run repeatedly. Creates what is missing, updates what
exists, and never deletes anything.

WHY A SCRIPT AND NOT A LIST OF CLI COMMANDS
-------------------------------------------
The deploy is eight ordered calls across four services, several of which have
to wait for eventual consistency (a fresh IAM role is not immediately usable by
Lambda). Doing that by hand is where demo-day failures come from.

WHAT IT CREATES
---------------
  IAM role        impact-guard-lambda-role   + CloudTrail LookupEvents policy
  Lambda          impact-guard-api           python3.12, 512MB, 30s
  HTTP API        impact-guard-api           $default route -> Lambda

COST
----
Comfortably inside the perpetual free tier: 1M Lambda requests/month and
1M API Gateway HTTP API calls/month. An idle deployment costs nothing.

USAGE
-----
    python3 tools/deploy.py                  # show the plan
    python3 tools/deploy.py --apply          # deploy
    python3 tools/deploy.py --apply --delete # remove everything it created
"""

import argparse
import io
import json
import sys
import time
import zipfile
from pathlib import Path

NAME = "impact-guard-api"
ROLE_NAME = "impact-guard-lambda-role"
RUNTIME = "python3.12"
HANDLER = "lambda_handler.handler"   # module.function, verified against the source
TIMEOUT = 30
MEMORY = 512

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"

TRUST_POLICY = {
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "lambda.amazonaws.com"},
        "Action": "sts:AssumeRole",
    }],
}

# Least privilege: the service only ever reads CloudTrail. It is deliberately
# NOT given ec2/s3/iam — the seeder needs those, the API does not.
READ_POLICY = {
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Action": ["cloudtrail:LookupEvents"],
        "Resource": "*",
    }],
}


def _c(service, region):
    try:
        import boto3
    except ImportError:
        sys.exit("boto3 is not installed. Run: pip install boto3")
    return boto3.client(service, region_name=region)


def build_zip() -> bytes:
    """Package the handler and app package. boto3 ships with the runtime."""
    buf = io.BytesIO()
    included = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(BACKEND / "lambda_handler.py", "lambda_handler.py")
        included += 1
        for path in sorted((BACKEND / "app").rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            z.write(path, str(path.relative_to(BACKEND)))
            included += 1
    # .env is deliberately not packaged: configuration comes from the
    # function's environment, and the file may hold local-only settings.
    return buf.getvalue(), included


def ensure_role(region):
    iam = _c("iam", region)
    try:
        arn = iam.get_role(RoleName=ROLE_NAME)["Role"]["Arn"]
        print(f"  role      exists    {arn}")
        fresh = False
    except iam.exceptions.NoSuchEntityException:
        arn = iam.create_role(
            RoleName=ROLE_NAME,
            AssumeRolePolicyDocument=json.dumps(TRUST_POLICY),
            Description="Impact Guard API - reads CloudTrail management events",
        )["Role"]["Arn"]
        print(f"  role      created   {arn}")
        fresh = True

    iam.attach_role_policy(
        RoleName=ROLE_NAME,
        PolicyArn="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    )
    iam.put_role_policy(
        RoleName=ROLE_NAME,
        PolicyName="impact-guard-cloudtrail-read",
        PolicyDocument=json.dumps(READ_POLICY),
    )
    print("  policies  attached  AWSLambdaBasicExecutionRole + cloudtrail:LookupEvents")

    if fresh:
        # IAM is eventually consistent; Lambda rejects a role it cannot yet see.
        print("  waiting   10s for IAM propagation ...")
        time.sleep(10)
    return arn


def ensure_function(region, role_arn, payload):
    lam = _c("lambda", region)
    env = {"Variables": {
        # The hosted API is public. Lock it to generated data so nobody can
        # read the deployment account's CloudTrail by posting mode="aws".
        "IMPACT_GUARD_DATA_MODE": "demo",
        "DATA_SOURCE": "demo",
        "BEDROCK_ENABLED": "false",   # account has no model access
        "CORS_ALLOW_ORIGIN": "*",
    }}
    try:
        lam.get_function(FunctionName=NAME)
        lam.update_function_code(FunctionName=NAME, ZipFile=payload)
        waiter = lam.get_waiter("function_updated_v2")
        waiter.wait(FunctionName=NAME)
        lam.update_function_configuration(
            FunctionName=NAME, Role=role_arn, Handler=HANDLER,
            Runtime=RUNTIME, Timeout=TIMEOUT, MemorySize=MEMORY, Environment=env,
        )
        waiter.wait(FunctionName=NAME)
        print(f"  lambda    updated   {NAME}")
    except lam.exceptions.ResourceNotFoundException:
        for attempt in range(6):
            try:
                lam.create_function(
                    FunctionName=NAME, Runtime=RUNTIME, Role=role_arn,
                    Handler=HANDLER, Code={"ZipFile": payload},
                    Timeout=TIMEOUT, MemorySize=MEMORY, Environment=env,
                    Description="Impact Guard - CloudTrail change investigation API",
                )
                break
            except lam.exceptions.InvalidParameterValueException:
                # Almost always the IAM role not yet visible to Lambda.
                if attempt == 5:
                    raise
                print(f"  lambda    role not visible yet, retrying ({attempt + 1}/5) ...")
                time.sleep(5)
        lam.get_waiter("function_active_v2").wait(FunctionName=NAME)
        print(f"  lambda    created   {NAME}")

    return lam.get_function(FunctionName=NAME)["Configuration"]["FunctionArn"]


def ensure_api(region, fn_arn):
    api = _c("apigatewayv2", region)
    existing = next(
        (a for a in api.get_apis()["Items"] if a["Name"] == NAME), None
    )
    if existing:
        api_id, endpoint = existing["ApiId"], existing["ApiEndpoint"]
        print(f"  http api  exists    {api_id}")
    else:
        created = api.create_api(
            Name=NAME, ProtocolType="HTTP", Target=fn_arn,
            CorsConfiguration={
                "AllowOrigins": ["*"],
                "AllowMethods": ["GET", "POST", "OPTIONS"],
                "AllowHeaders": ["content-type"],
            },
        )
        api_id, endpoint = created["ApiId"], created["ApiEndpoint"]
        print(f"  http api  created   {api_id}")

    # Allow API Gateway to invoke the function. Idempotent via a fixed Sid.
    lam = _c("lambda", region)
    account = _c("sts", region).get_caller_identity()["Account"]
    try:
        lam.add_permission(
            FunctionName=NAME, StatementId="apigw-invoke",
            Action="lambda:InvokeFunction", Principal="apigateway.amazonaws.com",
            SourceArn=f"arn:aws:execute-api:{region}:{account}:{api_id}/*/*",
        )
        print("  perms     granted   apigateway -> lambda")
    except lam.exceptions.ResourceConflictException:
        print("  perms     already granted")

    return endpoint


def delete_all(region):
    lam, api, iam = _c("lambda", region), _c("apigatewayv2", region), _c("iam", region)
    for a in api.get_apis()["Items"]:
        if a["Name"] == NAME:
            api.delete_api(ApiId=a["ApiId"])
            print(f"  deleted http api {a['ApiId']}")
    try:
        lam.delete_function(FunctionName=NAME)
        print(f"  deleted lambda {NAME}")
    except lam.exceptions.ResourceNotFoundException:
        pass
    try:
        iam.delete_role_policy(RoleName=ROLE_NAME,
                               PolicyName="impact-guard-cloudtrail-read")
        iam.detach_role_policy(
            RoleName=ROLE_NAME,
            PolicyArn="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole")
        iam.delete_role(RoleName=ROLE_NAME)
        print(f"  deleted role {ROLE_NAME}")
    except iam.exceptions.NoSuchEntityException:
        pass
    print("\nRemoved.")


def _friendly_aws_error(exc) -> str | None:
    """Turn common credential failures into one actionable line.

    boto3 raises these from deep inside the signing path, so the default
    traceback is ~60 frames of botocore internals with the real cause on the
    last line. Same treatment as tools/seed_incident.py.
    """
    name, msg = type(exc).__name__, str(exc)
    if "LoginRefreshRequired" in name or "session has expired" in msg:
        return ("Your AWS session has expired.\n"
                "  Either refresh it:        aws login\n"
                "  Or use a static-key profile that does not expire:\n"
                "      AWS_PROFILE=<profile> python3 tools/deploy.py ...")
    if "NoCredentials" in name or "Unable to locate credentials" in msg:
        return ("No AWS credentials found.\n"
                "  Run 'aws configure --profile <name>', then re-run with "
                "AWS_PROFILE=<name>.")
    if "ExpiredToken" in msg or "InvalidClientTokenId" in msg:
        return "Your AWS credentials are expired or invalid. Refresh them, then re-run."
    if "AccessDenied" in name or "UnauthorizedOperation" in name:
        return (f"Permission denied: {msg.split(': ', 1)[-1]}\n"
                "  Deploying needs IAM, Lambda and API Gateway permissions.")
    return None


def verify_handler():
    """Fail before deploying if HANDLER does not name a real function.

    Lambda reports this as Runtime.HandlerNotFound at invoke time, surfacing as
    an opaque 500 from API Gateway. Checking the source costs nothing.
    """
    module, _, func = HANDLER.rpartition(".")
    source = BACKEND / f"{module}.py"
    if not source.is_file():
        sys.exit(f"Handler module not found: {source}")
    import ast
    tree = ast.parse(source.read_text())
    names = {n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    if func not in names:
        sys.exit(f"Handler '{func}' not defined in {source.name}. "
                 f"Found: {', '.join(sorted(names)) or 'nothing'}")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ap-south-1")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--delete", action="store_true")
    p.add_argument("--yes", action="store_true",
                   help="skip the delete confirmation prompt")
    a = p.parse_args()

    if a.delete:
        if not a.apply:
            print(f"DRY RUN - would delete the {NAME} api, function and role "
                  f"in {a.region}.\nRe-run with --apply.")
            return 0
        # Deleting is not reversible from here: the API id changes on recreate,
        # so any published VITE_API_BASE stops working. Worth one prompt.
        print(f"About to delete from {a.region}:")
        print(f"    HTTP API   {NAME}   (its URL will not come back)")
        print(f"    Lambda     {NAME}")
        print(f"    IAM role   {ROLE_NAME}")
        if not a.yes:
            try:
                if input("\nType 'delete' to confirm: ").strip().lower() != "delete":
                    print("Cancelled - nothing was removed.")
                    return 1
            except (EOFError, KeyboardInterrupt):
                print("\nCancelled - nothing was removed.")
                return 1
        delete_all(a.region)
        return 0

    verify_handler()
    payload, count = build_zip()
    print(f"Region   {a.region}")
    print(f"Package  {len(payload) / 1024:.0f} KB, {count} python files\n")

    if not a.apply:
        print("DRY RUN - nothing created. Would create:\n")
        print(f"    IAM role   {ROLE_NAME}  (+ cloudtrail:LookupEvents)")
        print(f"    Lambda     {NAME}  {RUNTIME}, {MEMORY}MB, {TIMEOUT}s")
        print(f"    HTTP API   {NAME}  $default -> Lambda")
        print("\nAll within the perpetual free tier. Re-run with --apply.")
        return 0

    role_arn = ensure_role(a.region)
    fn_arn = ensure_function(a.region, role_arn, payload)
    endpoint = ensure_api(a.region, fn_arn)

    print(f"\nDeployed: {endpoint}")
    print(f"\nPoint the frontend at it:\n    VITE_API_BASE={endpoint}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - top level, the message matters
        friendly = _friendly_aws_error(exc)
        if friendly:
            sys.exit(f"\n{friendly}\n")
        raise

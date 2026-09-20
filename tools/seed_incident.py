#!/usr/bin/env python3
"""Generate a real incident in your own AWS account, using free resources only.

WHY THIS EXISTS
---------------
Impact Guard reads CloudTrail. On a brand-new or quiet account there is nothing
to read, so live mode returns an honest but unimpressive empty result. This
script performs a short, realistic sequence of control-plane changes so the
tool has genuine events to investigate — recorded by CloudTrail exactly as any
other change would be.

Nothing here is simulated. Every event this produces is a real AWS API call
made by you, in your account, and read back through the same LookupEvents path
the product uses in production.

COST
----
Only free resources are touched:
  * a security group      — security groups are free
  * an S3 bucket policy   — bucket creation and policy writes are free

No EC2 instances, no RDS, nothing that bills by the hour. The script deletes
everything it creates.

SAFETY
------
  * Dry run by default. Nothing happens without --apply.
  * Every resource is named with the SANDBOX_PREFIX so it is obvious what this
    created, and --cleanup removes exactly those.
  * The security group is created in your DEFAULT VPC and allows a port only
    from a private CIDR, never 0.0.0.0/0. Opening a database port to the
    internet for a demo is a genuinely bad idea, so the script will not do it.
  * It never touches anything it did not create.

USAGE
-----
    python3 tools/seed_incident.py                 # show the plan, change nothing
    python3 tools/seed_incident.py --apply         # create the events
    python3 tools/seed_incident.py --cleanup --apply  # remove what it created
"""

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

SANDBOX_PREFIX = "impact-guard-demo-prod"
# Deliberately private. The scoring engine rewards a production-looking name;
# it does not require the rule to be dangerously open, and we will not make it so.
SOURCE_CIDR = "10.0.0.0/16"
DB_PORT = 5432  # PostgreSQL — pairs with the tool's port-evidence graph rule


def _client(service, region):
    try:
        import boto3
    except ImportError:
        sys.exit("boto3 is not installed. Run: pip install boto3")
    return boto3.client(service, region_name=region)


def plan(region):
    return [
        f"Create security group '{SANDBOX_PREFIX}-web-sg' in the default VPC ({region})",
        f"Open port {DB_PORT} on it from {SOURCE_CIDR}      -> AuthorizeSecurityGroupIngress",
        f"Create bucket '{SANDBOX_PREFIX}-assets-<suffix>'",
        "Write a bucket policy on it                       -> PutBucketPolicy",
        "Remove that bucket policy                         -> DeleteBucketPolicy",
        f"Close port {DB_PORT} again                        -> RevokeSecurityGroupIngress",
        "",
        "Four real CloudTrail events, all free, ~15 seconds.",
    ]


def seed(region, pause):
    ec2 = _client("ec2", region)
    s3 = _client("s3", region)
    created = {"sg": None, "bucket": None}

    started = datetime.now(timezone.utc)
    print(f"Started at {started.isoformat()}\n")

    # --- Security group ----------------------------------------------------
    vpcs = ec2.describe_vpcs(Filters=[{"Name": "isDefault", "Values": ["true"]}])["Vpcs"]
    if not vpcs:
        sys.exit("No default VPC in this region. Pass --region for one that has one.")
    vpc_id = vpcs[0]["VpcId"]

    sg = ec2.create_security_group(
        GroupName=f"{SANDBOX_PREFIX}-web-sg",
        Description="Impact Guard demo sandbox - safe to delete",
        VpcId=vpc_id,
    )
    created["sg"] = sg["GroupId"]
    print(f"  created security group {created['sg']}")
    time.sleep(pause)

    ec2.authorize_security_group_ingress(
        GroupId=created["sg"],
        IpPermissions=[{
            "IpProtocol": "tcp", "FromPort": DB_PORT, "ToPort": DB_PORT,
            "IpRanges": [{"CidrIp": SOURCE_CIDR, "Description": "impact-guard demo"}],
        }],
    )
    print(f"  opened port {DB_PORT} from {SOURCE_CIDR}   -> AuthorizeSecurityGroupIngress")
    time.sleep(pause)

    # --- Bucket policy -----------------------------------------------------
    bucket = f"{SANDBOX_PREFIX}-assets-{uuid.uuid4().hex[:8]}"
    kwargs = {"Bucket": bucket}
    if region != "us-east-1":
        kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
    s3.create_bucket(**kwargs)
    created["bucket"] = bucket
    print(f"  created bucket {bucket}")
    time.sleep(pause)

    account = _client("sts", region).get_caller_identity()["Account"]
    s3.put_bucket_policy(Bucket=bucket, Policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Sid": "ImpactGuardDemoReadOwnAccount",
            "Effect": "Allow",
            "Principal": {"AWS": f"arn:aws:iam::{account}:root"},
            "Action": "s3:GetObject",
            "Resource": f"arn:aws:s3:::{bucket}/*",
        }],
    }))
    print("  wrote bucket policy                    -> PutBucketPolicy")
    time.sleep(pause)

    s3.delete_bucket_policy(Bucket=bucket)
    print("  removed bucket policy                  -> DeleteBucketPolicy")
    time.sleep(pause)

    ec2.revoke_security_group_ingress(
        GroupId=created["sg"],
        IpPermissions=[{
            "IpProtocol": "tcp", "FromPort": DB_PORT, "ToPort": DB_PORT,
            "IpRanges": [{"CidrIp": SOURCE_CIDR}],
        }],
    )
    print(f"  closed port {DB_PORT}                     -> RevokeSecurityGroupIngress")

    # Round UP to the next whole minute. The app's time picker has minute
    # precision, so a timestamp with seconds gets truncated downward — which
    # would place these changes *after* the incident and correctly stop them
    # being ranked as contributing causes. Reporting the next minute keeps the
    # sequence intact however it is entered.
    finished = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=1)
    print(f"\nDone. Use this as the incident time in Impact Guard:")
    print(f"  {finished.isoformat().replace('+00:00', 'Z')}")
    print(f"  (local: {finished.astimezone().strftime('%d/%m/%Y %H:%M')})")
    print("\nCloudTrail usually surfaces management events within a few minutes,")
    print("so wait ~5 minutes, then investigate in Live mode with a 30-minute window.")
    print(f"\nWhen finished, remove these resources:")
    print(f"  python3 tools/seed_incident.py --cleanup --apply --region {region}")
    return created


def cleanup(region):
    ec2 = _client("ec2", region)
    s3 = _client("s3", region)
    removed = 0

    groups = ec2.describe_security_groups(
        Filters=[{"Name": "group-name", "Values": [f"{SANDBOX_PREFIX}-*"]}]
    )["SecurityGroups"]
    for g in groups:
        ec2.delete_security_group(GroupId=g["GroupId"])
        print(f"  deleted security group {g['GroupId']} ({g['GroupName']})")
        removed += 1

    for b in s3.list_buckets()["Buckets"]:
        if not b["Name"].startswith(SANDBOX_PREFIX):
            continue
        # Only ever empties buckets this script created.
        objs = s3.list_objects_v2(Bucket=b["Name"]).get("Contents", [])
        for o in objs:
            s3.delete_object(Bucket=b["Name"], Key=o["Key"])
        s3.delete_bucket(Bucket=b["Name"])
        print(f"  deleted bucket {b['Name']}")
        removed += 1

    print(f"\nRemoved {removed} resource(s)." if removed else "\nNothing to remove.")


def _friendly_aws_error(exc) -> str | None:
    """Turn the common credential failures into one actionable line.

    boto3 raises these from deep inside the signing path, so the default
    traceback is ~60 frames of botocore internals with the actual cause on the
    last line. That is not a useful thing to hand someone mid-demo.
    """
    name = type(exc).__name__
    msg = str(exc)

    if "LoginRefreshRequired" in name or "session has expired" in msg:
        return ("Your AWS session has expired.\n"
                "  Either refresh it:        aws login\n"
                "  Or use a static-key profile that does not expire:\n"
                "      AWS_PROFILE=<profile> python3 tools/seed_incident.py ...")
    if "NoCredentials" in name or "Unable to locate credentials" in msg:
        return ("No AWS credentials found.\n"
                "  Run 'aws configure --profile <name>' then re-run with "
                "AWS_PROFILE=<name>.")
    if "ExpiredToken" in msg or "InvalidClientTokenId" in msg:
        return "Your AWS credentials are expired or invalid. Refresh them, then re-run."
    if "AccessDenied" in name or "UnauthorizedOperation" in name:
        return (f"Permission denied: {msg.split(': ', 1)[-1]}\n"
                "  This needs EC2 security-group and S3 bucket permissions.")
    return None


def preview_cleanup(region):
    """List exactly what a real cleanup would remove.

    The previous dry run only restated the rule ("would delete every
    impact-guard-demo-prod* resource"), which reads as though there is work to
    do even when the account is already clean. Looking costs one read call per
    service and answers the actual question.
    """
    try:
        ec2 = _client("ec2", region)
        s3 = _client("s3", region)
        groups = ec2.describe_security_groups(
            Filters=[{"Name": "group-name", "Values": [f"{SANDBOX_PREFIX}-*"]}]
        )["SecurityGroups"]
        buckets = [b["Name"] for b in s3.list_buckets()["Buckets"]
                   if b["Name"].startswith(SANDBOX_PREFIX)]
    except Exception as exc:
        friendly = _friendly_aws_error(exc)
        if not friendly:
            raise
        # Still say what it would do, even without credentials to check.
        print(f"DRY RUN — would delete every '{SANDBOX_PREFIX}*' security group and "
              f"bucket in {region}.\n")
        print(f"Could not list them:\n{friendly}")
        return

    if not groups and not buckets:
        print(f"Nothing to remove: no '{SANDBOX_PREFIX}*' resources in {region}.")
        print("\nNote that the CloudTrail events these produced are unaffected - "
              "management\nevents are retained for 90 days whether or not the "
              "resource still exists, so\nan investigation over that window still "
              "returns them.")
        return

    print(f"DRY RUN — nothing will be changed. Would delete from {region}:\n")
    for g in groups:
        print(f"    security group  {g['GroupId']}  ({g['GroupName']})")
    for b in buckets:
        print(f"    bucket          {b}")
    print(f"\n{len(groups) + len(buckets)} resource(s). Re-run with --apply to do it.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--apply", action="store_true", help="actually make the changes")
    ap.add_argument("--cleanup", action="store_true", help="remove what this created")
    ap.add_argument("--pause", type=float, default=3.0,
                    help="seconds between steps, so the timeline is readable")
    args = ap.parse_args()

    if args.cleanup:
        if not args.apply:
            preview_cleanup(args.region)
            return
        cleanup(args.region)
        return

    if not args.apply:
        print(f"DRY RUN — nothing will be changed. Plan for {args.region}:\n")
        for line in plan(args.region):
            print(f"  {line}" if line else "")
        print("\nRe-run with --apply to create these events.")
        return

    seed(args.region, args.pause)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - top level, message matters more than type
        friendly = _friendly_aws_error(exc)
        if friendly:
            sys.exit(f"\n{friendly}\n")
        raise

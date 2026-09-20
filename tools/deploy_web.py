#!/usr/bin/env python3
"""Publish the built frontend to S3 behind CloudFront.

Idempotent. Creates what is missing, updates what exists, deletes nothing.

WHY CLOUDFRONT AND NOT AN S3 WEBSITE ENDPOINT
---------------------------------------------
S3 static website hosting is HTTP-only and cannot carry a custom certificate.
CloudFront gives HTTPS, a global cache, and is the only path to a custom domain
later. The bucket stays private and is reached through an Origin Access Control,
so the site is only servable through the distribution.

SPA ROUTING
-----------
react-router owns /investigation, /briefing and the rest. S3 returns 403 for
those keys because no such object exists, so the distribution maps 403 and 404
back to /index.html with a 200. Without this every deep link 404s -- which only
shows up when someone reloads on an inner page, i.e. during a demo.

USAGE
    python3 tools/deploy_web.py                 # plan only
    python3 tools/deploy_web.py --apply
"""

import argparse
import json
import mimetypes
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "frontend" / "dist"
BUCKET_PREFIX = "impact-guard-web"
OAC_NAME = "impact-guard-web-oac"
CALLER_REF = "impact-guard-web-v1"

# Hashed asset filenames may be cached forever; index.html must not be, or a
# deploy silently serves the previous bundle until the cache expires.
IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "public, max-age=0, must-revalidate"


def _c(service, region="ap-south-1"):
    try:
        import boto3
    except ImportError:
        sys.exit("boto3 is not installed. Run: pip install boto3")
    return boto3.client(service, region_name=region)


def _friendly(exc):
    name, msg = type(exc).__name__, str(exc)
    if "LoginRefreshRequired" in name or "session has expired" in msg:
        return ("Your AWS session has expired.\n"
                "  Refresh it:  aws login\n"
                "  Or:          AWS_PROFILE=<profile> python3 tools/deploy_web.py ...")
    if "NoCredentials" in name or "Unable to locate credentials" in msg:
        return "No AWS credentials found. Run 'aws configure --profile <name>'."
    if "AccessDenied" in name:
        return f"Permission denied: {msg.split(': ', 1)[-1]}"
    return None


def bucket_name(account):
    # Bucket names are globally unique; the account id makes it deterministic.
    return f"{BUCKET_PREFIX}-{account}"


def ensure_bucket(s3, name, region):
    try:
        s3.head_bucket(Bucket=name)
        print(f"  bucket        exists    {name}")
    except Exception:
        kwargs = {"Bucket": name}
        if region != "us-east-1":
            kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        s3.create_bucket(**kwargs)
        print(f"  bucket        created   {name}")
    # Stays private: CloudFront reaches it through an Origin Access Control.
    s3.put_public_access_block(
        Bucket=name,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True, "IgnorePublicAcls": True,
            "BlockPublicPolicy": False, "RestrictPublicBuckets": False,
        },
    )


def upload(s3, name):
    if not DIST.is_dir():
        sys.exit(f"No build found at {DIST}.\n  Run: cd frontend && npm run build")
    count = 0
    for path in sorted(DIST.rglob("*")):
        if not path.is_file():
            continue
        key = str(path.relative_to(DIST))
        ctype = mimetypes.guess_type(key)[0] or "application/octet-stream"
        cache = NO_CACHE if key in ("index.html",) else IMMUTABLE
        s3.upload_file(str(path), name, key,
                       ExtraArgs={"ContentType": ctype, "CacheControl": cache})
        count += 1
    print(f"  upload        {count} files")
    return count


def ensure_oac(cf):
    for item in cf.list_origin_access_controls().get("OriginAccessControlList", {}).get("Items", []):
        if item["Name"] == OAC_NAME:
            print(f"  oac           exists    {item['Id']}")
            return item["Id"]
    created = cf.create_origin_access_control(
        OriginAccessControlConfig={
            "Name": OAC_NAME,
            "Description": "Impact Guard web -> private S3",
            "SigningProtocol": "sigv4", "SigningBehavior": "always",
            "OriginAccessControlOriginType": "s3",
        })["OriginAccessControl"]["Id"]
    print(f"  oac           created   {created}")
    return created


def ensure_distribution(cf, bucket, region, oac_id):
    for d in cf.list_distributions().get("DistributionList", {}).get("Items", []):
        if d.get("Comment") == CALLER_REF:
            print(f"  distribution  exists    {d['Id']}")
            return d["Id"], d["DomainName"]

    origin_domain = f"{bucket}.s3.{region}.amazonaws.com"
    cfg = {
        "CallerReference": f"{CALLER_REF}-{int(time.time())}",
        "Comment": CALLER_REF,
        "Enabled": True,
        "DefaultRootObject": "index.html",
        "Origins": {"Quantity": 1, "Items": [{
            "Id": "s3-origin", "DomainName": origin_domain,
            "OriginAccessControlId": oac_id,
            "S3OriginConfig": {"OriginAccessIdentity": ""},
        }]},
        "DefaultCacheBehavior": {
            "TargetOriginId": "s3-origin",
            "ViewerProtocolPolicy": "redirect-to-https",
            "AllowedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"],
                               "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}},
            "Compress": True,
            # CachingOptimized, an AWS-managed policy.
            "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
        },
        # SPA deep links: S3 has no object for /briefing, so map the miss to the app.
        "CustomErrorResponses": {"Quantity": 2, "Items": [
            {"ErrorCode": 403, "ResponseCode": "200",
             "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 10},
            {"ErrorCode": 404, "ResponseCode": "200",
             "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 10},
        ]},
        "PriceClass": "PriceClass_All",
    }
    d = cf.create_distribution(DistributionConfig=cfg)["Distribution"]
    print(f"  distribution  created   {d['Id']}")
    return d["Id"], d["DomainName"]


def allow_cloudfront(s3, bucket, account, dist_id):
    policy = {
        "Version": "2012-10-17",
        "Statement": [{
            "Sid": "AllowCloudFrontServicePrincipal",
            "Effect": "Allow",
            "Principal": {"Service": "cloudfront.amazonaws.com"},
            "Action": "s3:GetObject",
            "Resource": f"arn:aws:s3:::{bucket}/*",
            "Condition": {"StringEquals": {
                "AWS:SourceArn": f"arn:aws:cloudfront::{account}:distribution/{dist_id}"}},
        }],
    }
    s3.put_bucket_policy(Bucket=bucket, Policy=json.dumps(policy))
    print("  bucket policy set       (CloudFront only)")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ap-south-1")
    p.add_argument("--apply", action="store_true")
    a = p.parse_args()

    account = _c("sts", a.region).get_caller_identity()["Account"]
    bucket = bucket_name(account)
    files = len([f for f in DIST.rglob("*") if f.is_file()]) if DIST.is_dir() else 0

    print(f"Region   {a.region}")
    print(f"Bucket   {bucket}")
    print(f"Build    {files} files in frontend/dist\n")

    if not a.apply:
        print("DRY RUN - nothing created. Would create:\n")
        print(f"    S3 bucket     {bucket}  (private)")
        print(f"    OAC           {OAC_NAME}")
        print("    CloudFront    distribution with SPA error mapping")
        print("\nRe-run with --apply.")
        return 0

    s3 = _c("s3", a.region)
    cf = _c("cloudfront", "us-east-1")   # CloudFront is a global, us-east-1 API

    ensure_bucket(s3, bucket, a.region)
    upload(s3, bucket)
    oac = ensure_oac(cf)
    dist_id, domain = ensure_distribution(cf, bucket, a.region, oac)
    allow_cloudfront(s3, bucket, account, dist_id)

    # Always bust the cache, or a redeploy serves the previous index.html.
    cf.create_invalidation(
        DistributionId=dist_id,
        InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/*"]},
                           "CallerReference": str(time.time())})
    print("  invalidation  requested /*")

    print(f"\nLive at: https://{domain}")
    print("\nA new distribution takes 5-10 minutes to finish deploying worldwide.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - top level, the message matters
        friendly = _friendly(exc)
        if friendly:
            sys.exit(f"\n{friendly}\n")
        raise

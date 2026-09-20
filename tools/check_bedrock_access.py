#!/usr/bin/env python3
"""Report exactly why Bedrock is or is not usable, and stop the guessing.

WHY THIS EXISTS
---------------
A refused Converse call returns the single string "Operation not allowed" for
several unrelated causes: the model is not offered in the region, the account
is not entitled to it, or the licence agreement was never accepted. Those need
different fixes, so collapsing them into one error message sent us round in
circles.

GetFoundationModelAvailability reports the three conditions separately, so this
script asks for them directly and names the one that is actually failing.

    python3 tools/check_bedrock_access.py [--region ap-south-1]
"""

import argparse
import sys

CANDIDATES = [
    "anthropic.claude-3-5-sonnet-20240620-v1:0",
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "anthropic.claude-3-7-sonnet-20250219-v1:0",
    "anthropic.claude-sonnet-4-5-20250929-v1:0",
    "anthropic.claude-haiku-4-5-20251001-v1:0",
]

# Each condition, the plain meaning of a failure, and what actually fixes it.
DIAGNOSIS = {
    "regionAvailability": (
        "This model is not offered in this region.",
        "Pick a different region, or a model this region does offer.",
    ),
    "entitlementAvailability": (
        "Your account is not entitled to this model.",
        "Usually billing: the account must be fully activated with a valid "
        "payment method. A brand-new account can take a few hours.",
    ),
    "agreement": (
        "The licence agreement for this model was never accepted.",
        "The console's 'Model access' page has been retired. Access is now granted "
        "through two API calls - see the printed steps below.",
    ),
    "not-authorized": (
        "This account is blocked from requesting model access at all.",
        "PutUseCaseForModelAccess returns AccessDenied, so the use-case form "
        "cannot be submitted and no agreement can follow. This is an account-level "
        "restriction that only AWS can lift: open a support case describing the "
        "use case. Commonly hit by very new accounts and by promotional/credit "
        "accounts. Re-running the request will not help.",
    ),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="ap-south-1")
    args = ap.parse_args()

    try:
        import boto3
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError:
        sys.exit("boto3 is not installed. Run: pip install 'boto3' 'botocore[crt]'")

    try:
        who = boto3.client("sts", region_name=args.region).get_caller_identity()
    except (BotoCoreError, ClientError) as exc:
        sys.exit(f"No usable AWS credentials: {exc}")

    print(f"Account {who['Account']} as {who['Arn']}")
    print(f"Region  {args.region}\n")

    bedrock = boto3.client("bedrock", region_name=args.region)
    usable, blocked = [], []

    for model_id in CANDIDATES:
        try:
            a = bedrock.get_foundation_model_availability(modelId=model_id)
        except (BotoCoreError, ClientError) as exc:
            print(f"  ?  {model_id}\n       {str(exc).split(': ', 1)[-1]}")
            continue

        checks = {
            "regionAvailability": a.get("regionAvailability"),
            "entitlementAvailability": a.get("entitlementAvailability"),
            "agreement": a.get("agreementAvailability", {}).get("status"),
        }
        failed = [k for k, v in checks.items() if v != "AVAILABLE"]

        if not failed:
            usable.append(model_id)
            print(f"  OK {model_id}")
        else:
            blocked.append((model_id, failed))
            print(f"  NO {model_id}   blocked by: {', '.join(failed)}")

    print()
    if usable:
        print("Authorized. Point the backend at one of these:\n")
        print(f"  export BEDROCK_REGION={args.region}")
        print(f"  export BEDROCK_MODEL_ID={usable[0]}")
        print("\nThen restart the API. Python caches a failed import, so an "
              "already-running process will not pick this up.")
        return 0

    # Report each distinct cause once, rather than repeating it per model.
    print("No model is currently usable. What is blocking it:\n")
    for cause in dict.fromkeys(c for _, causes in blocked for c in causes):
        meaning, fix = DIAGNOSIS[cause]
        print(f"  {cause}\n    {meaning}\n    Fix: {fix}\n")
    if any("agreement" in causes for _, causes in blocked):
        _print_agreement_steps(bedrock, args.region, blocked[0][0])
    return 1


def _print_agreement_steps(client, region, model_id):
    """Print the exact commands, with this account's real offer token.

    Both calls are the user's to make: the second one accepts a legal agreement
    and commits the account to usage-based pricing, so this script shows the
    commands rather than running them.
    """
    print("-" * 62)
    print("Step 1 - submit the use-case form (once per account):\n")
    print("  cat > /tmp/bedrock-usecase.json <<'JSON'")
    print("""  {
    "companyName":    "<your company or project name>",
    "companyWebsite": "https://<your site>",
    "intendedUsers":  "<who will use it>",
    "industryOption": "Other",
    "otherIndustryOption": "<your industry>",
    "useCases":       "<what you will use the model for>"
  }""")
    print("  JSON")
    print(f"  aws bedrock put-use-case-for-model-access \\\n"
          f"      --form-data fileb:///tmp/bedrock-usecase.json --region {region}\n")

    print("Step 2 - accept the model agreement (repeat per model):\n")
    try:
        offers = client.list_foundation_model_agreement_offers(modelId=model_id)
        token = offers["offers"][0]["offerToken"]
        rates = offers["offers"][0].get("termDetails", {}) \
                     .get("usageBasedPricingTerm", {}).get("rateCard", [])
        priced = {r["description"]: r["price"] for r in rates}
        if priced:
            print("  Pricing you would be accepting (USD):")
            for k, v in list(priced.items())[:2]:
                print(f"    {v:>6} per {k}")
            print()
        print(f"  aws bedrock create-foundation-model-agreement \\\n"
              f"      --model-id {model_id} \\\n"
              f"      --offer-token {token[:40]}... \\\n"
              f"      --region {region}")
        print("\n  (full offer token:  aws bedrock list-foundation-model-agreement-offers")
        print(f"                        --model-id {model_id} --region {region})")
    except Exception as exc:
        print(f"  Could not fetch the offer token: {str(exc).split(': ', 1)[-1][:90]}")
    print("-" * 62)
    print("Re-run this script afterwards to confirm.")


if __name__ == "__main__":
    sys.exit(main())

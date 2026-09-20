#!/usr/bin/env python3
"""Request Bedrock model access: the use-case form, then the model agreement.

WHY THIS EXISTS
---------------
The Bedrock console's "Model access" page has been retired. Access is now
granted through two API calls, and the second one needs an offer token that is
several hundred characters long -- awkward to copy by hand.

WHAT IT DOES NOT DO
-------------------
It does not invent anything about you. Every value in the use-case form comes
from a flag you pass, because that form is a declaration AWS attributes to your
account. It also refuses to run without --accept-terms, because step two
accepts a licence agreement and commits the account to usage-based pricing.

USAGE
-----
    # see exactly what would be submitted, change nothing
    python3 tools/request_bedrock_access.py \
        --company "Impact Guard" \
        --website "https://github.com/<you>/impact-guard" \
        --users "Single developer, hackathon project" \
        --industry "Software" \
        --usecase "Summarising AWS CloudTrail change events during incident investigation"

    # actually submit
    ... same flags ...  --accept-terms --apply
"""

import argparse
import json
import sys

LOG_PATH = "/tmp/bedrock-request.log"


class _Tee:
    """Mirror everything printed into a log file."""

    def __init__(self, stream, path):
        self.stream = stream
        self.file = open(path, "w")

    def write(self, data):
        self.stream.write(data)
        self.file.write(data)

    def flush(self):
        self.stream.flush()
        self.file.flush()

DEFAULT_MODEL = "anthropic.claude-3-5-sonnet-20240620-v1:0"


def _client(service, region):
    try:
        import boto3
    except ImportError:
        sys.exit("boto3 is not installed. Run: pip install 'boto3' 'botocore[crt]'")
    return boto3.client(service, region_name=region)


def build_form(a):
    """Always declare the industry as "Other" with the text in the free field.

    industryOption is a fixed dropdown in the console, so passing arbitrary text
    there risks an enum rejection. "Other" is always valid, and the real answer
    still reaches AWS in otherIndustryOption.
    """
    return {
        "companyName": a.company,
        "companyWebsite": a.website,
        "intendedUsers": a.users,
        "industryOption": "Other",
        "otherIndustryOption": a.industry,
        "useCases": a.usecase,
    }


def price_lines(offer):
    rates = offer.get("termDetails", {}).get("usageBasedPricingTerm", {}).get("rateCard", [])
    out = []
    for r in rates:
        desc = r.get("description", r.get("dimension", ""))
        if "Token" in desc or "token" in desc:
            out.append(f"    {r.get('price','?'):>7} USD per {desc}")
    return out[:4]


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ap-south-1")
    p.add_argument("--model-id", default=DEFAULT_MODEL)
    p.add_argument("--company")
    p.add_argument("--website")
    p.add_argument("--users")
    p.add_argument("--industry")
    p.add_argument("--usecase")
    p.add_argument("--accept-terms", action="store_true",
                   help="affirm that you accept the model's licence and pricing")
    p.add_argument("--apply", action="store_true", help="actually submit")
    a = p.parse_args()

    # Ask for anything missing rather than failing on a half-pasted command.
    # These are declarations AWS attributes to your account, so they have to
    # come from you, but they do not have to come from the command line.
    PROMPTS = [
        ("company",  "Company or project name"),
        ("website",  "Website or repo URL"),
        ("users",    "Who will use it"),
        ("industry", "Industry"),
        ("usecase",  "What you will use the model for"),
    ]
    for attr, label in PROMPTS:
        while not getattr(a, attr):
            try:
                setattr(a, attr, input(f"  {label}: ").strip())
            except (EOFError, KeyboardInterrupt):
                sys.exit("\nCancelled - nothing was submitted.")

    bedrock = _client("bedrock", a.region)
    form = build_form(a)

    print(f"Region   {a.region}")
    print(f"Model    {a.model_id}\n")
    print("Use-case form that would be submitted:\n")
    for k, v in form.items():
        print(f"    {k:<22} {v}")

    # Show the pricing before anything is accepted, not after.
    try:
        offers = bedrock.list_foundation_model_agreement_offers(modelId=a.model_id)
        offer = offers["offers"][0]
    except Exception as exc:
        sys.exit(f"\nCould not read the agreement offer: {str(exc).split(': ', 1)[-1]}")

    lines = price_lines(offer)
    if lines:
        print("\nPricing you would be accepting:\n")
        print("\n".join(lines))

    if not (a.apply and a.accept_terms):
        missing = []
        if not a.apply: missing.append("--apply")
        if not a.accept_terms: missing.append("--accept-terms")
        print("\n" + "=" * 64)
        print("DRY RUN - NOTHING WAS SUBMITTED.")
        print(f"Nothing will change until you add: {' '.join(missing)}")
        print("=" * 64)
        return 0

    print("\nStep 1  submitting the use-case form ...")
    try:
        bedrock.put_use_case_for_model_access(
            formData=json.dumps(form).encode("utf-8")
        )
        print("        accepted")
    except Exception as exc:
        msg = str(exc)
        # Submitting twice is not an error worth stopping for.
        if "already" in msg.lower():
            print("        already on file")
        elif "not authorized" in msg or "AccessDenied" in msg:
            # The account cannot submit the form at all. Re-running changes
            # nothing, and no amount of correcting the form's contents helps.
            sys.exit(
                "        failed: this account is not permitted to request model "
                "access.\n\n"
                "  AWS is refusing the request itself, not its contents, so "
                "re-running\n"
                "  will not help and neither will editing the answers. Only AWS "
                "can lift\n"
                "  this, via a support case describing the use case:\n"
                "      https://console.aws.amazon.com/support/home\n\n"
                "  Commonly hit by very new accounts and by promotional/credit "
                "accounts.\n"
                "  Turnaround is typically a day or more, so if you are working to "
                "a\n"
                "  deadline, use an account that already has Bedrock access "
                "instead.\n"
            )
        else:
            sys.exit(f"        failed: {msg.split(': ', 1)[-1]}")

    print("Step 2  accepting the model agreement ...")
    try:
        bedrock.create_foundation_model_agreement(
            modelId=a.model_id, offerToken=offer["offerToken"]
        )
        print("        accepted")
    except Exception as exc:
        sys.exit(f"        failed: {str(exc).split(': ', 1)[-1]}")

    print("\nVerifying ...")
    av = bedrock.get_foundation_model_availability(modelId=a.model_id)
    ok = av.get("authorizationStatus") == "AUTHORIZED"
    print(f"    authorizationStatus  {av.get('authorizationStatus')}")
    print(f"    agreement            {av.get('agreementAvailability', {}).get('status')}")

    if ok:
        print(f"\nDone. Set the backend to use it:\n")
        print(f"    export BEDROCK_REGION={a.region}")
        print(f"    export BEDROCK_MODEL_ID={a.model_id}")
        print("\nThen restart the API.")
        return 0

    print("\nNot yet authorized. Access can take a few minutes to propagate; "
          "re-check with:\n    python3 tools/check_bedrock_access.py --region "
          f"{a.region}")
    return 1


if __name__ == "__main__":
    sys.stdout = _Tee(sys.stdout, LOG_PATH)
    try:
        code = main()
    finally:
        print(f"\n(full output saved to {LOG_PATH})")
        sys.stdout.flush()
    sys.exit(code)

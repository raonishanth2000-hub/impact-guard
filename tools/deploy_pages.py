#!/usr/bin/env python3
"""Publish frontend/dist to the gh-pages branch, served at a custom domain.

WHY GITHUB PAGES AND NOT CLOUDFRONT
-----------------------------------
This AWS account is not verified for CloudFront, and S3 website hosting is
HTTP-only, so there is no path to HTTPS on a custom domain through AWS here.
Pages gives a free managed certificate and needs one DNS record, with no
nameserver change - so the rest of the domain is untouched.

The API stays on AWS: Lambda behind API Gateway. Only the static bundle moves.

SPA ROUTING
-----------
Pages has no rewrite rules, so /briefing would 404. index.html is copied to
404.html: Pages serves it for any unknown path, React Router reads the URL and
renders the right view. The HTTP status is still 404, which is a real (if
cosmetic) wart - CloudFront would return 200.

USAGE
    python3 tools/deploy_pages.py --domain impact-guard.example.com
    python3 tools/deploy_pages.py --domain ... --apply
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "frontend" / "dist"
BRANCH = "gh-pages"


def run(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, cwd=cwd or ROOT, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"Command failed: {' '.join(cmd)}\n{r.stderr.strip()}")
    return r.stdout.strip()


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--domain", required=True, help="e.g. impact-guard.example.com")
    p.add_argument("--apply", action="store_true")
    a = p.parse_args()

    if not DIST.is_dir():
        sys.exit(f"No build at {DIST}.\n  Run: cd frontend && npm run build")

    files = sorted(f for f in DIST.rglob("*") if f.is_file())
    print(f"Domain   {a.domain}")
    print(f"Branch   {BRANCH}")
    print(f"Build    {len(files)} files\n")

    if not a.apply:
        for f in files:
            print(f"    {f.relative_to(DIST)}")
        print(f"\n    CNAME     -> {a.domain}")
        print("    404.html  -> copy of index.html (SPA deep links)")
        print("\nDRY RUN. Re-run with --apply.")
        return 0

    remote = run(["git", "remote", "get-url", "origin"])

    # Build the branch in a scratch clone: the working tree is never touched,
    # so an interrupted deploy cannot leave the project on a detached branch.
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "pages"
        run(["git", "init", "-q", str(work)], cwd=Path(tmp))
        run(["git", "remote", "add", "origin", remote], cwd=work)
        run(["git", "checkout", "-q", "--orphan", BRANCH], cwd=work)

        for f in files:
            dest = work / f.relative_to(DIST)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest)

        (work / "CNAME").write_text(a.domain + "\n")
        shutil.copy2(DIST / "index.html", work / "404.html")
        # Pages runs Jekyll by default, which ignores files starting with an
        # underscore. Vite does not emit any today, but this costs nothing and
        # removes a confusing future failure.
        (work / ".nojekyll").write_text("")

        run(["git", "add", "-A"], cwd=work)
        run(["git", "-c", "user.name=nishu",
             "-c", "user.email=raonishanth2000@gmail.com",
             "commit", "-q", "-m", f"Deploy to {a.domain}"], cwd=work)
        run(["git", "push", "-q", "--force", "origin", BRANCH], cwd=work)

    print(f"  pushed    {BRANCH}")
    print(f"  CNAME     {a.domain}")
    print(f"  404.html  written")
    print(f"\nNext: enable Pages on the {BRANCH} branch and point DNS at it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

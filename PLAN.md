# AWS Change Detective — Implementation Plan

## Context

When an incident starts, the first question is always *"what changed?"* — and answering
it today means hand-querying CloudTrail, reading raw JSON, and mentally correlating
timestamps. CloudTrail is a **system of record**, not an investigation tool: it answers
"show me API calls matching this filter," not "what changed shortly before 10:42 that
could plausibly touch checkout?"

This project builds the intelligent layer on top: collect CloudTrail management events,
normalize them into human-readable changes, score them against an incident time using
transparent deterministic rules, and use Bedrock to explain the shortlist — explicitly
without claiming causation.

Target: a 4-person team, ~5–6 hours, ending in a demo that runs with or without a live
AWS account.

## Environment findings (already verified on this machine)

| Check | Result | Consequence |
|---|---|---|
| Python | 3.14.7 | Fine. Backend is stdlib-only except boto3. |
| Node / npm | v26.8.2 / 11.19.1, registry reachable | Vite + React install will work. |
| `boto3` | **Not installed** | Live AWS mode cannot run until installed. |
| AWS CLI | **Not installed** | No credentials configured; cannot call CloudTrail/Bedrock. |
| `squadron/` | Unrelated existing project | Out of scope — will not be touched. |

**Design consequence:** `boto3` is imported *lazily*, inside the AWS code paths only.
Demo mode therefore runs on a bare Python install with zero dependencies. This is
deliberate — it makes the demo path the most reliable thing in the repo, which is what
matters when presenting.

## Architecture

```
                    ┌──────────────── DEMO MODE ────────────────┐
                    │  demo_data.py — generated sample events    │
                    └────────────────────┬───────────────────────┘
                                         │
CloudTrail LookupEvents ──► cloudtrail.py ──►  normalizer.py
   (LIVE MODE)                                      │
                                    raw JSON ──► NormalizedChange
                                                    │
                                              scoring.py
                                   (deterministic relevance engine)
                                                    │
                                        ranked + reasons[]
                                                    │
                                              bedrock.py
                                  (explanation only — never detection)
                                                    │
                                            investigation.py
                                                    │
                          lambda_handler.py  /  local_server.py
                                                    │
                                          API Gateway (deployed)
                                                    │
                                      React + Vite + Tailwind dashboard
```

Both entry points (`lambda_handler.py` for AWS, `local_server.py` for laptops) call the
**same** `api.py` route functions, so local dev and deployed behaviour cannot drift.

## File structure

```
aws-change-detective/
├── backend/
│   ├── app/
│   │   ├── config.py          ✅ DONE — env-var config, no secrets
│   │   ├── models.py             NormalizedChange, ScoredChange, Investigation
│   │   ├── catalog.py            event registry — THE extension point
│   │   ├── normalizer.py         raw CloudTrail → NormalizedChange
│   │   ├── scoring.py            deterministic relevance engine
│   │   ├── cloudtrail.py         live source (lazy boto3)
│   │   ├── demo_data.py          e-commerce scenario generator
│   │   ├── bedrock.py            Converse API, model via env var
│   │   ├── investigation.py      orchestration
│   │   ├── api.py                framework-agnostic route handlers
│   │   └── errors.py             typed errors → clean HTTP codes
│   ├── lambda_handler.py         API Gateway proxy adapter
│   ├── local_server.py           stdlib dev server, same routes
│   ├── requirements.txt
│   └── tests/test_smoke.py       scoring + normalization + end-to-end demo
├── frontend/                     React + Vite + Tailwind v4
│   └── src/
│       ├── api.js
│       ├── App.jsx
│       └── components/  ControlBar, Timeline, RelevantChanges,
│                        ChangeDetail, AiExplanation, RecommendedChecks
├── infra/
│   ├── iam-policy.json           least-privilege policy for the Lambda role
│   └── template.yaml             SAM template (optional deploy)
├── .env.example
├── PLAN.md
└── README.md
```

## The investigation engine (deterministic, pre-Bedrock)

Transparent additive scoring — no ML, fully explainable, capped at 100:

| Signal | Max | Rule |
|---|---|---|
| Time proximity | 40 | Linear decay across the lookback window. Events *after* the incident are heavily penalised (they cannot be a cause). |
| Service criticality | 12 | RDS / EC2 / Lambda / ELB / AutoScaling rank above S3 / IAM. |
| Destructive action | 18 | `Terminate*`, `Delete*`, `Stop*`, `Revoke*`. |
| Security sensitivity | 12 | Security groups, bucket policies, IAM changes. |
| Production-like name | 15 | Resource matches `prod`, `prd`, `production`, `live`. |
| Configuration change | 8 | `Modify*`, `Update*`, `Put*`. |

Bands: **HIGH ≥ 65**, **MEDIUM ≥ 40**, else **LOW**. Every scored event carries a
`reasons[]` array built from the same rules, so the UI explains itself even with Bedrock
switched off.

## Bedrock usage

- `bedrock-runtime` **Converse** API — model-agnostic, so `BEDROCK_MODEL_ID` can be
  repointed at any provider without touching code.
- Receives *structured, already-scored* events. It explains; it never detects or ranks.
- System prompt forbids causal language and requires hedged phrasing
  ("potentially related", "worth investigating", "occurred shortly before").
- Returns strict JSON: `summary`, `per_change[]`, `recommended_checks[]`.
- **Failure is non-fatal**: on any Bedrock error the API returns the deterministic
  investigation with `ai_available: false` and a rule-generated explanation. The
  dashboard stays fully useful.

## Build order (each step verified before moving on)

1. **Backend core** — models, catalog, normalizer, scoring + demo data.
   *Verify:* run scoring over the demo scenario, assert RDS@-1min ranks HIGH.
2. **API layer** — `api.py`, `local_server.py`, error handling.
   *Verify:* curl `/health`, `/events`, `/investigate` and inspect real JSON.
3. **Bedrock module** — with a forced-failure path exercised first.
   *Verify:* confirm the fallback renders before any real model call is made.
4. **Frontend** — Vite scaffold, API client, then components.
   *Verify:* load the demo incident in a browser, screenshot it.
5. **Live AWS path** — `cloudtrail.py`, IAM policy, SAM template.
   *Verify:* only possible once boto3 + credentials exist (see below).
6. **Docs** — README, `.env.example`, sample requests.

## What I need you to install

**Required only for LIVE AWS mode.** Demo mode — the whole dashboard, scoring engine and
fallback explanations — works right now without any of this.

```bash
pip3 install boto3
```

```bash
brew install awscli
```

Then configure credentials (either is fine):

```bash
aws configure
```

**One thing that is not an install and that I cannot do for you:** Bedrock model access
must be explicitly granted per-account, per-region in the AWS console under
*Bedrock → Model access*. Until a model is enabled there, every Bedrock call returns
`AccessDeniedException` — which our fallback handles gracefully, but you won't see real
AI output in the demo.

Optional, only if you want to deploy rather than demo locally:

```bash
brew install aws-sam-cli
```

I will run `npm install` for the frontend myself — no action needed from you.

## Risks and how they are handled

| Risk | Mitigation |
|---|---|
| Bedrock model not enabled / wrong ID | Fallback explanation path; model ID is an env var, swappable in seconds. |
| No AWS credentials at demo time | Demo mode is the default and needs nothing. |
| CloudTrail has no recent events in a fresh account | Live mode returns a clear empty-state, and the UI suggests demo mode. |
| Frontend build issues eat the clock | Tailwind v4 via the Vite plugin — single config line, no PostCSS chain. |
| Live AWS path unverifiable on this machine | Written defensively against documented API shapes and clearly marked as untested locally. I will not claim it is verified. |

## Honest scope note

With no AWS credentials on this machine, I can build and **verify** demo mode, the
scoring engine, the API, the error handling and the frontend end-to-end. The live
CloudTrail and Bedrock paths I can build and type-check but **cannot execute** here. I'll
mark them explicitly as untested rather than implying otherwise, and once you've
installed boto3 and configured credentials we can verify them together.

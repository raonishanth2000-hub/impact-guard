# 🔎 Impact Guard

**Find what changed before you start debugging.**

An investigation layer over CloudTrail. Give it the time an incident started;
it collects recent control-plane changes, ranks them by how plausibly they relate
to that incident using transparent rules, and tells you what to check first.

An Amazon Bedrock layer is implemented to put the ranked findings into prose, but
it is **not currently active** — see *Deployment status* below. Nothing depends on
it: the ranking, scores, dependency evidence and briefing are all produced by the
deterministic engine.

---

## 1. Problem

10:32 — the application is healthy.
10:42 — checkout requests start timing out.

The on-call engineer's first question is always the same: **"what changed?"**

Answering it today means opening the CloudTrail console, guessing at event-name
filters, expanding raw JSON records one at a time, mentally converting timestamps,
and trying to remember which of forty resources is actually on the checkout path.
That work happens during the outage, under pressure, when attention is the scarcest
resource in the building.

## 2. Solution

Impact Guard compresses that into one query. Enter the incident time; get back:

- a **timeline** of every control-plane change in the window, with the incident
  spliced in at its true position,
- each change **normalized into a sentence** — what changed, which resource, who
  did it, when, which service,
- a **relevance ranking** produced by explicit rules, with the reasons shown,
- a **Bedrock explanation** of the shortlist and concrete next checks.

### The language rule

The tool never claims a change caused an incident. It says *"potentially related"*,
*"worth investigating"*, *"occurred shortly before the incident"*. This is enforced
in three places: the Bedrock system prompt, the deterministic fallback text, and a
test (`test_fallback_never_asserts_causation`) that fails the build if causal
phrasing appears. Correlation in a timeline is not evidence, and a tool that blurs
that line sends engineers down the wrong path during an outage.

## 3. Why CloudTrail alone is not enough

CloudTrail is a **system of record**, and an excellent one. It is not an
investigation tool. Specifically:

| Doing this in CloudTrail | What Impact Guard does |
|---|---|
| Answers "show me API calls matching this filter" | Answers "what changed near 10:42 that might touch checkout" |
| Returns deeply nested raw JSON | Returns one readable sentence per change |
| Every event looks equally important | Ranks by proximity, blast radius and sensitivity, and shows why |
| Actor is buried in `userIdentity.sessionContext.sessionIssuer.userName` | Actor is a column: `deploy-role` |
| No notion of an incident | The incident is the anchor the whole view is organised around |
| Failed calls look like successful ones | Failed calls are damped — they changed nothing |

We are not replacing CloudTrail. CloudTrail is our data source. We are building the
triage layer that does not ship with it.

## 4. Architecture

```
                  ┌───────────── DEMO MODE ─────────────┐
                  │  demo_data.py (generated events)     │
                  └──────────────────┬───────────────────┘
                                     │
CloudTrail LookupEvents ──► cloudtrail.py ──► normalizer.py
      (LIVE MODE)                                  │
                                            NormalizedChange
                                                   │
                                             scoring.py
                                  deterministic relevance engine
                                     (runs BEFORE any AI call)
                                                   │
                                      ranked changes + reasons[]
                                                   │
                                             bedrock.py
                                   explanation only, never detection
                                    (falls back to rules on failure)
                                                   │
                                          investigation.py
                                                   │
                            ┌──────────────────────┴───────────────┐
                    lambda_handler.py                      local_server.py
                    (API Gateway)                          (localhost:8000)
                            └──────────────────────┬───────────────┘
                                                   │
                                  React + Vite + Tailwind dashboard
```

Both entry points call the same `app/api.py:dispatch`, so local behaviour and
deployed behaviour cannot drift apart.

### Why the rules engine runs first

The ranking must be reproducible and explainable. If a model decided what was
relevant, we could not tell an engineer *why* a change was surfaced, and the answer
would change between runs. So the rules pick and rank; Bedrock explains what the
rules picked. That also means **the product still works with AI switched off** —
which is exactly what happens when a model is not enabled, and it degrades to
"slightly less fluent" instead of "broken".

## 5. AWS services used

| Service | Role | Essential? |
|---|---|---|
| **CloudTrail** | Source of all change data (`LookupEvents`) | Yes — it is the product's input |
| **Amazon Bedrock** | Natural-language explanation — *implemented, currently inactive* | No — degrades gracefully |
| **AWS Lambda** | Runs the API — deployed, `python3.12` | Yes |
| **API Gateway** | HTTP front door — deployed, HTTP API | Yes |
| **EC2 / S3** | Used by `tools/seed_incident.py` to generate real change events | No — demo data only |
| **IAM** | Least-privilege role; no static keys anywhere | Yes |
| **CloudWatch Logs** | Lambda logs | Automatic |

Deliberately **not** used: no DynamoDB, no S3, no queues, no VPC. Every
investigation is a stateless read. Adding storage would have bought nothing and
cost setup time.


## 5a. Deployment status

What is actually running, as opposed to what is implemented:

**Live at [impact-guard.nishanthrao.com](https://impact-guard.nishanthrao.com)** —
frontend on GitHub Pages, API on AWS.

| | Status |
|---|---|
| Frontend | **Live.** `impact-guard.nishanthrao.com`, HTTPS enforced. |
| CloudTrail `LookupEvents` | **Live.** Real management events, 90-day window, no trail required. |
| Lambda + API Gateway | **Deployed.** `python3.12`, least-privilege role whose only permission is `cloudtrail:LookupEvents`. |
| Deterministic engine | **Live.** Scoring, ranking, dependency evidence, plain-language briefing. |
| Amazon Bedrock | **Implemented, inactive.** |

**On Bedrock.** The code is complete — Converse API, regional inference-profile
retry, credential diagnostics, graceful fallback, 15 tests — but it has never
returned a response. AWS blocks *model access requests* for this account at the
account level: `PutUseCaseForModelAccess` returns `AccessDenied` in every region
tested, as both root and an IAM user with `AdministratorAccess`, while
`GetFoundationModelAvailability` reports the account as entitled. Only an AWS
support case can lift that.

It is disabled explicitly (`BEDROCK_ENABLED=false`) rather than left to fail:
each doomed call cost two network round trips, measured at 0.39s versus 0.002s
with it off.

This is the architecture behaving as designed. The engine detects; the model only
ever reworded what the engine had already decided. Losing it costs no finding.


### Why the frontend is not on CloudFront

This AWS account is not verified for CloudFront (`Your account must be verified
before you can add new CloudFront resources`), and S3 website hosting is
HTTP-only, so there is no route to HTTPS on a custom domain through AWS here.
Route 53 Domains is likewise unavailable on this account. The static bundle
therefore ships to GitHub Pages, which issues a managed certificate and needs a
single CNAME.

The API is unaffected — it runs on Lambda behind API Gateway, and every
investigation still reads CloudTrail from AWS.

One consequence: Pages has no rewrite rules, so a deep link such as `/briefing`
returns HTTP 404. `404.html` is a copy of `index.html`, so the app boots and
React Router renders the right view — the status code is simply wrong.
CloudFront would return 200.

## 6. How AI is used

Bedrock is called through the **Converse API**, so the model can be swapped by
changing one environment variable — no code change, and it works across model
families.

It receives events the rules engine has **already selected and scored**, as
structured JSON including each event's rule-based reasons. It returns:

1. what changed,
2. why it may matter,
3. whether it is potentially related to the incident,
4. what to investigate next.

Guardrails:

- The system prompt forbids causal claims and requires hedged phrasing.
- The model is told never to invent events, resources, timestamps or metrics.
- Only the top `MAX_EVENTS_TO_EXPLAIN` (default 8) events are sent, bounding cost
  and latency.
- Every failure mode — no credentials, model not enabled, wrong model id,
  unparseable output — falls back to a deterministic explanation. The UI labels
  which one you are reading (`Bedrock` vs `Rule-based` badge) rather than passing
  rule output off as AI output.

## 7. Local development

Requires **Python 3.9+**. Demo mode needs **no pip install at all**.

```bash
cd backend && python3 local_server.py
```

```bash
cd frontend && npm install && npm run dev
```

Open <http://localhost:5273> and click **Load demo incident**.

Vite proxies `/api` → `http://127.0.0.1:8000`, so there is no CORS setup in dev.

Run the tests:

```bash
cd backend && python3 tests/test_smoke.py && python3 tests/test_bedrock.py
```

## 8. AWS setup

**a. Credentials** — never hardcoded. boto3 uses the standard provider chain.

```bash
aws configure
```

**b. CloudTrail** — a trail is *not* required. `LookupEvents` serves the last 90
days of management events in every region by default.

**c. Enable a Bedrock model** — this is the step people miss. In the AWS console go
to **Bedrock → Model access**, request access to a Claude model, wait for it to
show *Access granted*, then copy its exact model id into `BEDROCK_MODEL_ID`.

Some regions expose only cross-region **inference profiles**, in which case the id
needs a region prefix (`apac.anthropic.claude-…`, `us.anthropic.claude-…`). If you
get a `ValidationException`, that is usually why — the app surfaces this as a
readable hint rather than a stack trace.

**d. Deploy** (optional):

```bash
cd infra && sam build && sam deploy --guided
```

Take `ApiUrl` from the outputs and build the frontend against it:

```bash
cd frontend && VITE_API_BASE=https://xxxx.execute-api.ap-south-1.amazonaws.com npm run build
```

## 9. Demo mode

Demo mode generates realistic CloudTrail events for an e-commerce environment,
anchored on whatever incident time you pick — so the scenario always looks current.

```
-7 min   AuthorizeSecurityGroupIngress   prod-web-security-group   (0.0.0.0/0 on 5432)
-3 min   UpdateFunctionConfiguration     prod-checkout-api         (timeout 30s -> 3s)
-1 min   ModifyDBInstance                prod-orders-db            (applyImmediately)
 0 min   INCIDENT: checkout requests started timing out
+2 min   RevokeSecurityGroupIngress      prod-web-security-group   (remediation)
```

Surrounded by eight realistic distractors — an analytics replica change, a payment
Lambda deploy, EC2 lifecycle noise, a bucket policy edit, and a **failed**
`TerminateInstances` — so the ranking is visibly doing work rather than sorting by
time.

It needs no AWS account, no credentials and no network. Switch with the
**Demo / Live AWS** toggle, the `mode` field on any request, or `DATA_SOURCE`.

## 10. Live AWS mode

Set `DATA_SOURCE=aws` (or flip the toggle, or pass `"mode": "aws"`). The backend
then calls `cloudtrail:LookupEvents` filtered to `ReadOnly=false`, because without
that filter the response is overwhelmingly `Describe*`/`List*` calls that cannot
have changed anything.

Live mode surfaces real failures as readable messages, not stack traces: missing
credentials, denied permissions, wrong region, unreachable endpoint.

## 11. IAM requirements

Full policy in [`infra/iam-policy.json`](infra/iam-policy.json). Minimum:

| Action | Why | Resource |
|---|---|---|
| `cloudtrail:LookupEvents` | Read management events | `*` (no resource-level support) |
| `bedrock:InvokeModel` | Explanations | Scoped to the Claude model family |
| `logs:CreateLogStream`, `logs:PutLogEvents` | Lambda logging | This function's log group |

Everything is **read-only**. Impact Guard cannot modify any AWS resource, by
design — it is an investigation tool, and giving it write access would be an
unnecessary blast radius during an incident.

## 12. API endpoints

`GET /health` — status, config (no secrets), supported event types.

`GET /events?minutes=30&mode=demo` — recent changes, no incident anchor.

`POST /investigate` — the main endpoint.

```bash
curl -X POST http://localhost:8000/investigate \
  -H 'Content-Type: application/json' \
  -d '{
    "incident_time": "2026-09-19T10:42:00+05:30",
    "lookback_minutes": 30,
    "description": "Checkout requests started timing out",
    "mode": "demo"
  }'
```

Returns `incident`, `stats`, `timeline`, `changes[]` (each with `relevance`,
`score`, `reasons[]`, `signals{}`), and `explanation`.

`POST /explain` — re-run only the explanation, optionally for a subset:

```bash
curl -X POST http://localhost:8000/explain \
  -H 'Content-Type: application/json' \
  -d '{"incident_time":"2026-09-19T10:42:00+05:30","mode":"demo","event_ids":["..."]}'
```

Errors are always structured:

```json
{ "error": { "code": "validation_error",
             "message": "incident_time is not a valid ISO-8601 timestamp.",
             "detail": "Expected something like 2026-09-19T10:42:00+05:30." } }
```

## 13. Scoring engine

Transparent, additive, capped at 100. No ML.

| Signal | Max | Rule |
|---|---|---|
| Time proximity | 50 | Decays with exponent 1.5 from the incident backwards |
| Service criticality | 12 | RDS / Lambda / ELB rank above S3 / IAM |
| Destructive action | 18 | `Terminate*`, `Delete*`, `Stop*`, `Revoke*` |
| Security sensitivity | 12 | Security groups, bucket policies, IAM |
| Production-like name | 15 | Matches `prod`, `prd`, `production`, `live` |
| Configuration change | 8 | `Modify*`, `Update*`, `Put*` |

**HIGH ≥ 65**, **MEDIUM ≥ 40**, else LOW. Two adjustments that matter:

- A **failed** call is multiplied by 0.4 — it almost certainly changed nothing.
- A change **after** the incident started can never be HIGH, whatever else it
  scores. It cannot be a contributing cause. It stays visible because it is often
  remediation worth seeing in a post-mortem.

### Adding a new event type

One `register(...)` call in [`backend/app/catalog.py`](backend/app/catalog.py).
Normalization, scoring and the UI all read from that registry:

```python
register(EventSpec(
    event_name="DeleteDBInstance",
    service="RDS",
    category="lifecycle",
    summary="Deleted RDS database instance {resource}",
    resource_type="RDS DB instance",
    resource_keys=("dBInstanceIdentifier",),
    destructive=True,
))
```

Currently supported: `ModifyDBInstance`, `UpdateFunctionConfiguration`,
`UpdateFunctionCode`, `RunInstances`, `StopInstances`, `TerminateInstances`,
`AuthorizeSecurityGroupIngress`, `RevokeSecurityGroupIngress`, `PutBucketPolicy`,
`DeleteBucketPolicy`, `UpdateAutoScalingGroup`.

Unknown events are still collected and displayed with a generic summary — they just
receive no service-specific bonuses.

## 14. Future improvements

- **Correlate with CloudWatch alarms** to anchor the incident time automatically
  instead of typing it.
- **Resource graph awareness** — today "production-like" is a name-matching
  heuristic; reading actual tags and security-group/subnet relationships would let
  us say a change touched *this* service rather than guessing from its name.
- **Diff the actual before/after state**, not just the API call. CloudTrail records
  the request, not the resulting configuration.
- **Multi-region and organisation trails** for accounts with workloads spread out.
- **Deployment correlation** — overlay CI/CD deploys next to infrastructure changes.
- **Feedback loop** — let engineers mark a change as "this was it", and use the
  labels to tune the signal weights.

## 15. Honest limitations

- `LookupEvents` covers **management events only**. Data-plane events (S3 object
  access, Lambda invokes) are not visible.
- CloudTrail delivery is typically a **few minutes behind**, so a change made
  seconds before an incident may not have landed yet.
- "Production-like" is **name matching**. A production database called `db-7` is
  invisible to that signal.
- The signal weights are **hand-tuned judgement**, validated against the demo
  scenario, not learned from incident data.
- Live CloudTrail and real Bedrock calls were **not executable in the build
  environment** (no credentials, no model access). Those paths are covered by
  stubbed tests, not by a real AWS round trip.

---

Built for the WeMakeDevs × AWS *First Commit* hackathon.

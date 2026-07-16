# KeepFlow

**The next safe step for everyday routines and life disruptions.**

KeepFlow is a **Lifestyle Continuity Companion**: an Agent Service Provider
(ASP) that helps people keep moving through everyday routines and disruptive
moments with a clear, safe next step.

It currently exposes four paid, stateless services:

- **Daily Flow - Constraint-Aware Meal & Movement Checklist**
- **First Move - Ordered Incident Recovery**
- **KeepFlow Study - Academic Execution**
- **KeepFlow Work - Operational Handover**

---

## First Move

Describe what just went wrong and receive a structured recovery plan. First Move
ranks actions by priority (personal safety → active irreversible loss →
still-exploitable access → the downstream cascade → evidence → longer-window
recovery), maps the dependency cascade the incident sets off, lists material
unknowns and clarifying questions, and states its limitations. Its value is
**ORDER + CASCADE**, not a generic checklist.

Supported incidents (digital-access triage):

- Stolen or lost phone
- Account takeover
- Lost or compromised 2FA / authenticator access
- Possible seed phrase or private-key exposure

Anything else returns a structured *unknown / insufficient-context* response —
universal safety steps, explicit assumptions, and up to three clarifying
questions. It never invents a cascade to satisfy the schema.

**Defensive, procedural guidance only.** First Move never requests or stores
passwords, seed phrases, private keys, 2FA codes, or full card numbers.

## Daily Flow

Daily Flow turns a caller's adult wellness goal and real-world constraints into
a one-day meal-and-movement checklist. It supports gradual loss, gradual gain,
and maintenance. It is deliberately not a disease-treatment or crash-diet
service.

International food-context packs cover representative major countries across
inhabited continents:

- Africa: Nigeria, Ghana, Kenya, South Africa, Egypt, Ethiopia
- Asia: China, India, Japan, Indonesia, the Philippines, Vietnam
- Europe: United Kingdom, France, Germany, Italy, Spain, Poland
- North America: United States, Canada, Mexico
- South America: Brazil, Argentina, Colombia, Peru
- Oceania: Australia, New Zealand
- Middle East and custom contexts are also supported

The context pack preserves local terminology, but `available_foods` remains the
source of truth. Daily Flow never invents a local dish, price, availability, or
nutrient value. Every suggested food must come from the caller's supplied list
after allergy, intolerance, and avoidance exclusions.

Safety gates return `professional_review` without calorie, meal, or movement
prescriptions for callers under 18, pregnancy, breastfeeding, eating-disorder
history/recovery, unexplained weight change, active allergy symptoms, or a
declared serious kidney, liver, heart, or metabolic condition. Allergy output
always requires label and cross-contact checks and never certifies a meal as
allergy-safe. The service is stateless and does not store health data.

The design is grounded in authoritative guidance: WHO says a healthy diet's
exact composition varies with individual characteristics, cultural context,
locally available foods, and customs; FAO maintains country-specific food-based
dietary guidelines; the China pack is informed by FAO's record of the 2022
Dietary Guidelines for Chinese. The adult-only and pregnancy/breastfeeding gates
follow the scope restrictions used by the US NIDDK Body Weight Planner.

Research references:

- WHO healthy diet: https://www.who.int/news-room/fact-sheets/detail/healthy-diet
- FAO dietary-guidelines repository: https://www.fao.org/nutrition/education/dietary-guidelines/home/en/
- FAO China dietary-guidelines profile: https://www.fao.org/nutrition/education/food-dietary-guidelines/regions/china/en/
- NIDDK Body Weight Planner: https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner
- FDA food-allergy resources: https://www.fda.gov/food/food-labeling-nutrition/food-allergies

Call Daily Flow locally:

```bash
curl -sX POST localhost:8080/v1/daily-flow \
  -H 'content-type: application/json' \
  -d '{
    "goal":"maintain",
    "profile":{
      "age":32,
      "height_cm":168,
      "weight_kg":68,
      "sex_for_energy_equation":"female",
      "activity_level":"lightly_active"
    },
    "constraints":{
      "food_context_pack":"china",
      "allergies":["peanut"],
      "available_foods":["rice","tofu","bok choy","egg","orange","sweet potato"]
    },
    "health_screen":{}
  }'
```

## KeepFlow Study

KeepFlow Study converts declared academic tasks, deadlines, dependencies, and
real availability windows into an ordered execution plan. It schedules only
inside caller-provided time, keeps impossible workloads visible, and attaches a
definition and evidence of done to each session. It supports international IANA
timezones, Unicode content, limited internet/device access, accessibility needs,
and pressure-aware load reduction.

It organizes legitimate study work; it does not generate assessed submissions,
take live assessments, impersonate learners, invent citations, or promise
grades. Academic-integrity requests are redirected to permitted preparation,
and an immediate safety concern pauses study scheduling.

Endpoint: `POST /v1/study-flow`

The session design follows evidence-based study principles such as spacing,
retrieval practice, and using checks to identify what needs more study, as
summarized by the US Institute of Education Sciences:
https://ies.ed.gov/ncee/wwc/PracticeGuide/1

## KeepFlow Work

KeepFlow Work turns caller-provided operational state into a structured
handover: dependency-aware priorities, ownership and responsibility maps,
blocker/dependency/access/risk/decision registers, a handover checklist,
unknowns, and escalation triggers. Missing owners, dates, status, evidence, or
authorization remain explicitly unknown rather than being invented.

Credentials and access tokens are rejected before payment. Requests to share
credentials, bypass controls, obtain unauthorized access, or conceal evidence
are blocked. Legal, HR, medical, financial-execution, regulated, and
safety-critical content is held behind an authorized-review gate and does not
receive invented operational instructions.

Endpoint: `POST /v1/work-handover`

The handover model reflects the UK Health and Safety Executive's core principle
that reliable handover requires preparation, task-relevant written and verbal
exchange, and cross-checking by the recipient:
https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm

## How First Move works (hybrid engine)

```
request → validate input → redact secrets → danger/misuse gate →
classify (deterministic + optional Claude) → select runbook + applicable actions →
order → build cascade → deterministic validation → repair if needed →
quality evaluation → response (Cache-Control: no-store)
```

- **Curated, versioned runbooks** are the product logic (in `src/playbooks/`).
  Each has an id, version, required assumptions, conditional actions with
  triggers, a dependency cascade, prohibited claims, escalation conditions, and
  a fallback.
- **Claude is used only for classification and action selection**, constrained
  to the runbook catalog and validated for membership — it cannot introduce
  actions absent from the selected runbook. With no `ANTHROPIC_API_KEY`, the
  service runs deterministic-only and is fully functional.
- **Two-tier checks**, honestly separated: deterministic *validation* (schema,
  enums, sequential steps, no URLs/phones/emails/secret-shaped output, cascade
  references, action membership, prohibited claims, no unsourced deadlines) vs.
  a separate *quality evaluation* (genericness, ordering, cascade relevance) —
  the latter is heuristic and non-blocking, not a schema guarantee.

## Secret handling

Never requests, persists, logs, echoes, or sends detected credentials to the
model provider. Input is scanned for seed phrases, private keys, passwords, 2FA
codes, and card data *before* any model call; detected values are replaced with
`[REDACTED_SECRET]`. A likely seed/key exposure skips model classification and
returns the deterministic exposure playbook. Request bodies are never logged.
All responses set `Cache-Control: no-store`.

## Run locally

```bash
npm install
cp .env.example .env      # optional: set ANTHROPIC_API_KEY to enable the hybrid path
npm run dev               # http://localhost:8080
```

Health check:

```bash
curl localhost:8080/health
```

Call First Move:

```bash
curl -sX POST localhost:8080/v1/first-move \
  -H 'content-type: application/json' \
  -d '{"description":"someone stole my phone on the train, my email was logged in"}'
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch-mode dev server (`tsx`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the test suite (`vitest`) |

## Payments (x402 via the OKX Payment SDK)

Uses the official **`@okxweb3/x402-express`** SDK (`src/payments/okx-sdk.ts`),
wired in `app.ts` to protect `POST /v1/daily-flow`, `POST /v1/first-move`,
`POST /v1/study-flow`, and `POST /v1/work-handover` (`/` and `/health` stay
free). `PAYMENTS_ENABLED` defaults to `false` for local development. Every paid
call uses the configured price, currently `$0.05` by default. Strict input and
credential checks run before the payment challenge, so malformed or sensitive
requests are rejected without asking the customer to pay.

When enabled, the SDK owns the whole payment lifecycle: it emits the **HTTP 402**
challenge (base64 `PAYMENT-REQUIRED` header — JSON for API/SDK clients, an HTML
paywall only for browsers), verifies the presented `PAYMENT-SIG`, and settles on
**X Layer** (`eip155:196`). Credentials (`OKX_API_KEY` / `OKX_SECRET_KEY` /
`OKX_PASSPHRASE`) are read from the environment; the resource server initializes
against the OKX facilitator on startup — so **real OKX credentials + a payout
address are required for the endpoint to emit a 402 at all**.

**Fails closed:** `PAYMENTS_ENABLED=true` but OKX creds or `PAY_TO_ADDRESS`
missing → `500 payment_misconfigured` on the paid route, never a free call. The
app still starts cleanly (the OKX middleware is only constructed when fully
configured, so there's no startup dependency in dev).

To go live: set `OKX_*` + `PAY_TO_ADDRESS`, `PAYMENTS_ENABLED=true`, then
register/list the ASP on OKX.AI via Onchain OS (Agentic Wallet).

## Layout

```
keepflow/
├── src/
│   ├── server.ts, app.ts, config.ts
│   ├── routes/        health, firstmove, daily-flow, study-flow, work-handover
│   ├── schemas/       strict input/output contracts for all four services
│   ├── security/      secret redaction plus danger and misuse gates
│   ├── engine/        deterministic planning, validation, repair, and evaluation
│   ├── playbooks/     versioned digital-incident recovery runbooks
│   ├── payments/      OKX x402 middleware and central paid-route registry
│   └── observability/ privacy-safe structured logging
├── tests/             unit, adversarial, and full HTTP-stack coverage
├── Dockerfile
└── README.md
```

# KeepFlow

**The next safe step for everyday routines and life disruptions.**

KeepFlow is a **Lifestyle Continuity Companion**: an Agent Service Provider
(ASP) that helps people keep moving through everyday routines and disruptive
moments with a clear, safe next step.

The public root, `GET /`, is a responsive product landing page. The original
machine-readable service descriptor is available at `GET /service.json`, while
`GET /openapi.json` publishes the exact request contract for every paid route.
`GET /health` reports process liveness and `GET /ready` additionally checks that
the configured OKX facilitator supports KeepFlow's X Layer payment scheme.

The professional asset roadmap is specified in
[`docs/ASSET_CREATION_ROADMAP.md`](docs/ASSET_CREATION_ROADMAP.md). Presentation
Pack is live, and Continuity Pack now creates bounded PDF and DOCX briefs. General
office-document generation, XLSX, career, and video outputs remain roadmap items.

It currently exposes four core paid, stateless services through eight endpoints.
Reminder Pack, Continuity Pack, and Context & Routing are cross-service companion capabilities, not
additional core services:

- **Daily Flow - Constraint-Aware Meal & Movement Checklist**
- **First Move - Ordered Incident Recovery**
- **KeepFlow Study - Academic Execution, Grounded Learning & Research Support**
- **KeepFlow Work - Operational Handover**
- **Reminder Pack - Importable Calendar Alerts** *(companion capability)*
- **Presentation Pack - Grounded PowerPoint + Speaker Notes** *(shared Study/Work capability)*
- **Continuity Pack - Access-Aware Actions + PDF/DOCX/ICS** *(flagship orchestration capability)*
- **Context & Routing - Consented Live Place and Route Discovery** *(shared real-world discovery capability)*

---

## Context & Routing

Context & Routing is an internal shared layer, not a separate endpoint. Daily
Flow, First Move, and Continuity Pack activate it only when the request includes
`real_world_context` with explicit one-request location permission and supplied
coordinates. The active service decides which place categories match the need;
the caller supplies radius, travel mode, urgency, and relevant constraints.

The response ranks up to eight nearby candidates and returns provider-sourced
place data, retrieval timestamps, routes where available, transparent ranking
reasons, and separate confirmed/unverified facts. It never claims that opening
hours, staffing, availability, accessibility, allergy safety, price, or route
safety are guaranteed. Immediate requests also state that discovery is not an
emergency-dispatch service.

Production discovery uses Google Places API (New) and Routes API from the
server. Set `GOOGLE_MAPS_API_KEY` and keep `CONTEXT_ROUTING_ENABLED=true`.
Restrict the key to those two APIs and the VPS public IP. When it is missing,
KeepFlow returns `503 context_routing_unavailable` before x402, so the customer
is not charged for an unusable lookup. KeepFlow does not intentionally persist
caller coordinates and never logs request bodies.

```json
{
  "description": "My phone and wallet were stolen while travelling alone.",
  "real_world_context": {
    "location_permission": true,
    "origin": { "latitude": 6.5244, "longitude": 3.3792 },
    "search": {
      "radius_m": 3000,
      "travel_mode": "walking",
      "urgency": "urgent"
    }
  }
}
```

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

## Reminder Pack

Reminder Pack turns future actions from any KeepFlow plan into a standards-based
`.ics` calendar file with display alarms. The caller supplies one or more event
times, titles, durations, alert lead times, and the originating KeepFlow service.
The response includes a base64-encoded calendar file that can be imported into
Google Calendar, Apple Calendar, Outlook, or another compatible application.

This is real calendar reminder support, but it is not a background notification
server. KeepFlow remains stateless: it does not store events, contact users, or
claim that an alert was delivered. The calendar application delivers alerts only
after the user imports the file and permits notifications. Event times must be at
least ten minutes in the future; up to 50 events and seven-day alert lead times are
supported. Credential-shaped content is rejected before payment.

Call Reminder Pack locally:

```bash
curl -sX POST localhost:8080/v1/reminder-pack \
  -H 'content-type: application/json' \
  -d '{
    "calendar_name":"KeepFlow Study Week",
    "timezone":"Africa/Lagos",
    "events":[{
      "id":"study-001",
      "title":"Review cellular respiration",
      "starts_at":"2035-07-16T18:00:00+01:00",
      "duration_minutes":45,
      "alert_minutes_before":15,
      "source_service":"study"
    }]
  }'
```

## KeepFlow Study

KeepFlow Study converts declared academic tasks, deadlines, dependencies, and
real availability windows into an ordered execution plan. It schedules only
inside caller-provided time, keeps impossible workloads visible, and attaches a
definition and evidence of done to each session. It supports international IANA
timezones, Unicode content, limited internet/device access, accessibility needs,
and pressure-aware load reduction.

The same core service also provides **Study Assist**: a student can supply text
or an extractable PDF, ask for a detailed explanation, summary, or fresh
practice questions, and optionally request traceable research candidates. Study
Assist grounds learning output in exact excerpts from the supplied material;
research metadata is fetched separately so the tutor model cannot invent a DOI,
publication title, or URL.

It organizes legitimate study work; it does not generate assessed submissions,
take live assessments, impersonate learners, invent citations, or promise
grades. Academic-integrity requests are redirected to permitted preparation,
and an immediate safety concern pauses study scheduling.

Endpoints:

- `POST /v1/study-flow` — academic execution planning
- `POST /v1/study-assist` — grounded material learning and research discovery

### Study Assist operations

- `explain_material` explains the supplied material at the requested learner
  level and depth. A `question` is required.
- `summarize_material` produces a grounded summary of the supplied material.
- `practice_questions` creates new self-check questions and answer guidance
  from the supplied material. A `question` describing the practice focus is
  required; it does not reproduce a live assessment.
- `recommend_sources` searches for research candidates without requiring an
  upload. `research.enabled` and an explicit `research.query` are required.

Every request declares `subject`, `topic`, `learner_level`, `output_language`,
`depth`, an allowed `academic_integrity.requested_action`, and
`external_processing_acknowledged: true`. The acknowledgement is mandatory
because sanitized material chunks may be sent to the configured tutor provider
and research queries are sent to Crossref.

Supported learner levels are `primary`, `secondary`, `vocational`,
`undergraduate`, `postgraduate`, `professional`, and `other`; supported depths
are `concise`, `standard`, and `detailed`.

### Material limits and grounding

Study Assist accepts one material object per request:

- Text: `type: "text"`, a 1–160 character title, and 80–24,000 characters of
  content.
- PDF: `type: "pdf_base64"`, a title, and canonical padded base64 in `data`.
  Do not include whitespace or a `data:` URI prefix. The decoded PDF must be at
  most 1 MiB, at most 40 pages, and at most 24,000 extracted characters.

PDF parsing runs in a bounded worker with a maximum five-second parse window.
Encrypted, malformed, image-only/scanned PDFs, and PDFs without enough
extractable text are rejected before payment. OCR, images, DOCX, and other file
types are not supported in this release.

When `ANTHROPIC_API_KEY` is configured and `STUDY_AI_ENABLED=true`, the selected
`STUDY_AI_MODEL` receives only bounded, sanitized chunks. Every generated
summary, explanation section, concept, glossary item, misconception correction,
and practice item must reference valid evidence IDs. The response resolves those
IDs to exact excerpts and text offsets or PDF page locations in the normalized,
sanitized extracted-text representation. Model output containing a URL, a
secret, or an unknown evidence ID is rejected.

If the tutor is disabled, times out, or returns invalid output, the endpoint
returns `mode: "partial"` with a clearly labelled deterministic source map. It
does not pretend that fallback excerpts are an AI-authored explanation.

### Research recommendations

Research discovery accepts a 3–300 character query, an optional
`published_after_year`, and `max_sources` from 1 to 6 (default 4). It queries
Crossref for DOI-bearing journal-article metadata and copies the normalized
provider result into the response without tutor-model rewriting, with a
canonical `https://doi.org/...` link. Depending on the subject, the response can
also include fixed official search-portal links for Crossref, ERIC, or PubMed.
Portal links are search destinations, not citations or evidence.

`crossref_registry_record_found` means a matching registry record was found.
`no_crossref_update_flag_at_retrieval_time` means Crossref did not report a
registered update for that record at retrieval time. Neither status proves peer
review, accuracy, relevance, publication quality, or the absence of every
correction/retraction. Crossref metadata can be incomplete, and inclusion is not
an endorsement. Students should open the paper, inspect the methods and venue,
check current correction/retraction information, and follow course requirements
before citing it. If Crossref is unavailable or finds no qualifying record,
KeepFlow returns no invented fallback citation.

KeepFlow evaluates up to 25 registry candidates before returning at most six.
Results are ranked using Crossref's query-relevance score plus bounded metadata
completeness and citation-count signals. Every result includes a transparent
quality tier and the warning that registry verification does not validate the
paper's methods or claims.

### Study Assist privacy and integrity

KeepFlow has no user database: it does not durably retain uploads or conversations and
sets `Cache-Control: no-store`. Before the payment step, it parses and bounds the
material, rejects credential-shaped content, and masks direct email addresses,
labelled phone numbers, and labelled student/learner/matriculation IDs. For a
request that proceeds to payment, the raw body is cleared first; bounded
sanitized data is held only for the active response and cleared on response
finish/close. Mutable PDF bytes are zeroed on a best-effort basis.

For safe network retries, callers may provide a high-entropy `Idempotency-Key`
(24-128 permitted characters). A successful JSON result is retained only in
process memory for 15 minutes so the same request can be replayed without a
second payment; it is never written to disk and is removed on expiry or restart.
Reusing the key with a different validated request returns `409`.

Secret detection rejects passwords, private keys, payment-card data, OTPs,
access tokens, and connection credentials without echoing their values. Name
detection is intentionally not claimed: person names are not reliably masked,
so callers must remove unnecessary names and other identifying information.

External processing is real. Sanitized chunks may be processed under the AI
provider's own retention and privacy terms, and research queries are processed
by Crossref. `CROSSREF_MAILTO`, when configured, must be an operator contact—not
a learner email or material-derived address. Do not upload content you are not
authorized to share.

Call Study Assist with text plus optional research discovery:

```bash
curl -sX POST localhost:8080/v1/study-assist \
  -H 'content-type: application/json' \
  -d '{
    "operation":"explain_material",
    "subject":"Biology",
    "topic":"Cellular respiration and ATP production",
    "learner_level":"undergraduate",
    "question":"Explain how the electron transport chain supports ATP synthesis.",
    "output_language":"English",
    "depth":"detailed",
    "material":{
      "type":"text",
      "title":"Course notes: cellular respiration",
      "content":"During oxidative phosphorylation, electrons move through membrane protein complexes. Their energy pumps protons across the inner mitochondrial membrane, creating an electrochemical gradient that ATP synthase uses to produce ATP."
    },
    "research":{
      "enabled":true,
      "query":"mitochondrial electron transport chain ATP synthase review",
      "published_after_year":2018,
      "max_sources":4
    },
    "academic_integrity":{"requested_action":"learn_concepts"},
    "external_processing_acknowledged":true
  }'
```

For PDF input, replace `material` with this JSON shape (base64 data abbreviated
here and therefore not directly callable):

```json
{
  "type": "pdf_base64",
  "title": "Authorized course handout",
  "data": "JVBERi0xLjQ...canonical-padded-base64...=="
}
```

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

## Continuity Pack

Continuity Pack is KeepFlow's flagship cross-service orchestration capability.
One request describes the disruption, location, deadlines, stakeholders, and the
user's real access to a safe place, another device, a borrowed phone, internet,
money, identification, a trusted person, and transport. Every access state must
be declared as `available`, `unavailable`, or `unknown`.

The response includes a next-15-minutes/today/next-seven-days timeline,
ready-to-send stakeholder messages, bounded delegation cards, an importable ICS
calendar, and printable PDF and DOCX briefs. Any step that relies on an
unavailable or unknown resource includes a viable alternative route. The service
does not contact providers, send messages, run background reminders, or store the
request or generated files.

Endpoint: `POST /v1/continuity-pack`

```bash
curl -sX POST localhost:8080/v1/continuity-pack \
  -H 'content-type: application/json' \
  -d '{
    "situation_type":"stolen_phone_or_wallet",
    "description":"I am travelling alone and my phone and wallet were stolen at the station.",
    "location":{"country":"France","city_or_area":"Paris","away_from_home":true},
    "access":{
      "safe_place":"available",
      "another_device":"unavailable",
      "borrowed_phone":"unavailable",
      "internet":"unavailable",
      "money":"unavailable",
      "identification":"unavailable",
      "trusted_person":"available",
      "transport":"unknown"
    },
    "stakeholders":["bank_or_card_provider","mobile_carrier","family_or_friend","embassy_or_consulate"],
    "immediate_deadlines":[],
    "timezone":"Europe/Paris",
    "include_artifacts":{}
  }'
```

`GET /metrics` exposes only process-lifetime aggregate counts and artifact byte
totals. It never exposes descriptions, messages, contact details, or artifact
contents.

## Presentation Pack

Presentation Pack is a shared KeepFlow Study and KeepFlow Work capability. It
turns 1–20 bounded, caller-supplied evidence items into a real 3–10 slide
PowerPoint presentation with speaker notes. The first release supports grounded
Work and Study decks. Continuity Pack separately supports bounded PDF/DOCX
briefs; general DOCX/XLSX generation and video outputs remain roadmap items.

Every content slide references one or more caller-supplied evidence IDs. The
optional model plans the narrative and visible copy through a strict tool schema;
unknown evidence IDs, malformed slide structure, URLs, and secret-shaped output
are rejected. If the model is disabled, unavailable, or returns an invalid plan,
KeepFlow generates a deterministic evidence-organized deck instead.

Before payment, the route validates and bounds the request, blocks prohibited
academic work, rejects credentials, masks direct emails and labelled phone or
student IDs, clears the raw body, and retains only sanitized source items for the
active response. The generated OOXML archive is checked for required parts,
slide count, speaker notes, CRC integrity, and prohibited active/external
components before it is returned as bounded canonical base64.

Endpoint: `POST /v1/presentation-pack`

```bash
curl -sX POST localhost:8080/v1/presentation-pack \
  -H 'content-type: application/json' \
  -d '{
    "domain":"work",
    "title":"Project Northstar executive update",
    "purpose":"Give leadership a concise evidence-based status update and next decision.",
    "audience":"Senior leadership team",
    "requested_slide_count":5,
    "source_items":[
      {"id":"E001","label":"Delivery status","content":"The design review is complete. Two integration dependencies remain open."},
      {"id":"E002","label":"Decision required","content":"Leadership must choose the support model before final verification."},
      {"id":"E003","label":"Next actions","content":"The delivery lead will confirm dependency owners. Operations will document support options."}
    ],
    "branding":{},
    "external_processing_acknowledged":true
  }'
```

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

Requires Node.js 24 or newer.

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
`POST /v1/study-flow`, `POST /v1/study-assist`, `POST /v1/work-handover`, and
`POST /v1/reminder-pack`, `POST /v1/presentation-pack`, and
`POST /v1/continuity-pack` (`/`, `/health`, `/service.json`, and `/metrics` stay
free). These eight paid routes
belong to the four core services; Study planning and Study Assist are two
capabilities of KeepFlow Study, and Reminder Pack is a cross-service companion
capability rather than a separate core service. Presentation Pack is a shared
Study/Work capability, while Continuity Pack is the flagship cross-service
orchestration capability. Neither is a fifth core service.
`PAYMENTS_ENABLED` defaults to `false` for local development. Every paid call
uses the configured price, currently `$0.05` by default. Strict input,
academic-integrity, material, and credential checks run before the payment
challenge, so unusable or prohibited requests are rejected without asking the
customer to pay or contacting an external provider.

When enabled, the SDK owns the whole payment lifecycle: it emits the **HTTP 402**
challenge (base64 `PAYMENT-REQUIRED` header — JSON for API/SDK clients, an HTML
paywall only for browsers), verifies the presented `PAYMENT-SIGNATURE`, and settles on
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
│   ├── routes/        health plus eight paid capability routes
│   ├── schemas/       strict input/output contracts for all four services
│   ├── security/      secret/identifier controls plus danger, integrity, and misuse gates
│   ├── engine/        planning, bounded material extraction, grounded tutoring, and validation
│   ├── research/      bounded Crossref discovery plus fixed official portal links
│   ├── playbooks/     versioned digital-incident recovery runbooks
│   ├── payments/      OKX x402 middleware and central paid-route registry
│   └── observability/ privacy-safe structured logging
├── tests/             unit, adversarial, and full HTTP-stack coverage
├── Dockerfile
└── README.md
```

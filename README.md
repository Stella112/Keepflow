# KeepFlow

**When life breaks, keep it moving.**

KeepFlow is an Agent Service Provider (ASP) that produces structured recovery
plans when a digital-access asset — a phone, an account, a second factor, or a
crypto key — is disrupted.

Its first service is **First Move — Ordered Incident Recovery**.

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

## How it works (hybrid engine)

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
wired in `app.ts` to protect `POST /v1/first-move` only (`/` and `/health` stay
free). `PAYMENTS_ENABLED` defaults to `false` (unpaid access for local dev).

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
│   ├── routes/        health.ts, firstmove.ts
│   ├── schemas/       firstmove-input.ts, firstmove-output.ts
│   ├── security/      redact-secrets.ts, danger-gate.ts, misuse-gate.ts
│   ├── engine/        classify-incident, model-classifier, order-actions,
│   │                  build-cascade, build-plan, validate-plan, repair-plan,
│   │                  evaluate-plan
│   ├── playbooks/     stolen-phone, account-takeover, lost-authenticator,
│   │                  seed-key-exposure, types, index
│   ├── payments/      okx-x402.ts (stub), result-cache.ts
│   └── observability/ logger.ts
├── tests/
├── Dockerfile
└── README.md
```

# KeepFlow Asset Creation Roadmap

Status: Phase 1 Presentation Pack is implemented; later phases remain planned.

## Product goal

KeepFlow should turn one prompt plus optional source material into polished,
ready-to-use assets. This extends the existing Lifestyle Continuity Companion
without turning it into a general media editor.

The four core services remain unchanged. The new capabilities sit under
KeepFlow Study and KeepFlow Work:

1. **KeepFlow Presentation Pack** — shared by Study and Work.
2. **KeepFlow Work Assets** — executive documents, reports, presentations and
   action-register spreadsheets.
3. **KeepFlow Study Assets** — grounded study guides, research briefs,
   presentations and planning workbooks.
4. **KeepFlow Career Pack** — a Work capability that produces truthful,
   role-specific career assets.
5. **KeepFlow Video Briefing** — a later Presentation Pack output, not a
   CapCut-style editing service.

## Customer-facing capabilities

### 1. Presentation Pack

One prompt and optional source material produce:

- editable PowerPoint (`.pptx`);
- presentation PDF;
- speaker notes (`.docx`);
- source/citation manifest;
- optional action register (`.xlsx`);
- optional calendar reminders (`.ics`); and
- later, a short narrated briefing (`.mp4`) with transcript and captions.

Work examples include executive updates, handover decks, project reports,
client proposals and onboarding presentations. Study examples include
source-grounded academic presentations, research overviews, revision decks and
speaker notes.

### 2. Work Assets

Supported pack types:

- `executive_update`;
- `project_status`;
- `operational_handover`;
- `meeting_decision_pack`;
- `client_brief`; and
- `onboarding_pack`.

Possible outputs:

- executive report (`.docx` and `.pdf`);
- status deck (`.pptx`);
- action, risk and dependency register (`.xlsx`);
- decision log (`.docx` or `.xlsx`); and
- calendar pack (`.ics`).

Unknown owners, dates, decisions, metrics and statuses must remain unknown.
KeepFlow must never invent business facts to make an asset look complete.

### 3. Study Assets

Supported pack types:

- `study_guide`;
- `research_brief`;
- `presentation_pack`;
- `revision_pack`; and
- `assignment_planning_pack`.

Possible outputs:

- grounded study guide (`.docx` and `.pdf`);
- presentation (`.pptx`);
- speaker notes (`.docx`);
- verified-source and citation map (`.docx` or `.json`);
- study/revision workbook (`.xlsx`); and
- calendar reminders (`.ics`).

Every factual claim derived from supplied material must retain an evidence ID.
Research metadata must continue to come from the research provider rather than
being invented by a tutor model. Existing academic-integrity restrictions stay
in force: KeepFlow supports learning, planning and presentation preparation but
does not impersonate a learner or produce a prohibited assessed submission.

### 4. Career Pack

Inputs are the user's verified experience plus a target job description.
Possible outputs:

- ATS-compatible resume (`.docx` and `.pdf`);
- role-specific cover letter (`.docx`);
- keyword coverage and job-fit evidence table (`.xlsx`);
- experience-gap report (`.docx`);
- LinkedIn headline and summary;
- interview preparation guide;
- STAR-story worksheet; and
- application tracker (`.xlsx`).

No employment, qualification, date, skill, metric or achievement may be
invented. Missing evidence is returned as a question or clearly marked
placeholder. KeepFlow may report transparent keyword coverage and document
compatibility checks, but must not promise an ATS pass or fabricate an opaque
"ATS score".

### 5. Video Briefing (phase two)

The first video feature is deliberately narrow:

- render a verified KeepFlow presentation into a short briefing;
- use supplied or explicitly approved narration;
- provide a transcript and `.srt` captions;
- normalize audio and use simple, consistent transitions; and
- provide a thumbnail.

Out of scope: arbitrary video editing, stickers, social filters, face/voice
cloning, deepfakes, copyrighted-media scraping and identity impersonation.

## API design

Add four paid capabilities:

- `POST /v1/presentation-pack`
- `POST /v1/work-assets`
- `POST /v1/study-assets`
- `POST /v1/career-pack`

Presentation Pack is shared infrastructure. The other endpoints choose
domain-specific templates and safeguards. They are capabilities beneath Study
and Work, not additional core services.

Common input fields:

```json
{
  "purpose": "executive project update",
  "audience": "senior management",
  "output_language": "English",
  "source_material": [],
  "requested_outputs": ["pptx", "docx", "xlsx"],
  "brand": {
    "name": "Example Company",
    "primary_color": "123247",
    "accent_color": "18B7AF"
  },
  "constraints": {
    "slide_count": 6,
    "presentation_minutes": 5
  },
  "external_processing_acknowledged": true
}
```

The response remains agent-friendly JSON. Each generated file uses the same
pattern already proven by Reminder Pack:

```json
{
  "filename": "executive-update.pptx",
  "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "byte_length": 123456,
  "sha256": "...",
  "content_base64": "..."
}
```

MVP limits:

- no more than four files per pack;
- no more than 8 MiB decoded output in total;
- bounded source-material size and item count;
- bounded slide, page, worksheet and row counts; and
- hard generation timeouts.

Large video responses must not be placed in base64 JSON. Video requires a
separate short-lived download design with automatic deletion and is therefore
not part of the first launch.

## Internal architecture

### Canonical asset plan

All endpoints first produce a strict, domain-neutral `AssetPlan`:

```text
validated request
  -> sanitized source bundle
  -> evidence/fact ledger
  -> domain planner
  -> schema-validated AssetPlan
  -> deterministic file renderers
  -> file verification
  -> response manifest
```

The model may organize supplied facts, but it must not directly write arbitrary
files. Renderers accept only the validated `AssetPlan`. The plan contains:

- document/deck title and audience;
- sections/slides/sheets;
- evidence references;
- explicit unknowns and placeholders;
- speaker notes;
- tables and chart data;
- requested output formats; and
- brand tokens.

### Suggested source layout

```text
src/
  artifacts/
    types.ts
    asset-plan.ts
    evidence-ledger.ts
    output-manifest.ts
    limits.ts
    renderers/
      pptx-renderer.ts
      docx-renderer.ts
      xlsx-renderer.ts
      pdf-renderer.ts
    templates/
      work/
      study/
      career/
  routes/
    presentation-pack.ts
    work-assets.ts
    study-assets.ts
    career-pack.ts
  schemas/
    artifact-common.ts
    presentation-pack-input.ts
    work-assets-input.ts
    study-assets-input.ts
    career-pack-input.ts
    asset-pack-output.ts
```

Reuse the existing Study text/PDF extractor, Reminder Pack generator, secret
scanner, privacy-safe logger and exact paid-route protections rather than
creating parallel implementations.

## File-generation stack

- **PPTX:** PptxGenJS. It supports Node/TypeScript, in-memory output, charts,
  tables, master layouts and speaker notes.
- **DOCX:** `docx`. It creates OOXML documents and can export a Node `Buffer`.
- **XLSX:** ExcelJS for workbooks, worksheets, formatting, tables and in-memory
  output.
- **PDF:** use a bounded Node PDF renderer with templates; do not depend on
  converting Office files inside the request path for MVP.
- **Video later:** FFmpeg with a fixed argument builder, no shell interpolation,
  strict input/output limits and `ffprobe` validation.

No user text may be inserted into a shell command. FFmpeg must be started with
an argument array through `spawn`, with network protocols disabled and all
files confined to a per-request temporary directory.

## Payment and request pipeline

Each new route follows the existing safe order:

```text
exact canonical route
  -> size/content-type limits
  -> schema validation
  -> secret and misuse checks
  -> source extraction and sanitization
  -> server-only prevalidation marker
  -> x402 payment
  -> planning and rendering
  -> output verification
  -> clear temporary buffers/files
```

Update `PAID_ROUTE_SPECS` so all new endpoints fail closed if prevalidation or
payment protection is missing. Add an optional per-route price field before
launching asset packs; their model and rendering cost should be measured rather
than assuming the existing `$0.05` price is profitable.

## Safety and truthfulness requirements

1. Reject credentials, private keys, OTPs and payment-card data before payment.
2. Treat uploaded instructions as untrusted data, not system instructions.
3. Maintain a fact/evidence ledger for every generated claim.
4. Keep unknown business facts unknown.
5. Keep direct contact fields separate from model prompts in Career Pack; merge
   them deterministically into the final resume after generation.
6. Never invent citations, work history, grades, qualifications or metrics.
7. Do not log request bodies or generated personal documents.
8. Set `Cache-Control: no-store` and zero/clear mutable buffers when practical.
9. Embed only user-supplied or licensed images and fonts.
10. Reject prompt-injection attempts to override product rules.

## Verification strategy

### Unit and schema tests

- strict input/output schemas and unknown-field rejection;
- source-size, file-count and output-size limits;
- evidence-reference membership;
- no invented owners, dates, citations or resume claims;
- academic-integrity and career-truthfulness gates;
- secret detection before x402;
- filename, MIME type, SHA-256 and base64 validation; and
- canonical-route alias rejection for every new paid endpoint.

### File tests

- unzip and inspect generated OOXML packages;
- reopen generated PPTX, DOCX and XLSX with independent parsers;
- verify required slides, sections, sheets and speaker notes;
- verify every asset is non-empty and below its size ceiling;
- verify spreadsheet formulas/links cannot be injected from user text;
- run golden-template tests for representative Study, Work and Career packs;
  and
- use an isolated CI rendering job to convert Office files to previews and
  visually check overflow, clipping and broken layouts.

### End-to-end tests

- malformed requests fail before payment;
- valid unpaid requests receive the correct x402 challenge;
- paid requests return a complete, verified artifact pack;
- provider failure returns an explicit error/partial result, never fabricated
  files;
- concurrent calls remain within memory/time limits; and
- existing seven paid endpoints and all current tests remain unchanged.

## Rollout order

### Phase 1 — submission-strengthening MVP

1. Shared `AssetPlan`, evidence ledger and output manifest.
2. Presentation Pack with real `.pptx` and speaker notes.
3. Work `executive_update` template.
4. Study `presentation_pack` template grounded in supplied material.
5. Full tests, live x402 call and landing-page demo.

### Phase 2 — professional asset packs

1. DOCX executive report and study guide.
2. XLSX action register, study planner and source table.
3. Career Pack resume, cover letter and transparent keyword analysis.
4. PDF versions and downloadable sample outputs.

### Phase 3 — video briefing

1. Render verified slides to images.
2. Add approved narration and timed captions.
3. Assemble MP4 with FFmpeg and validate with `ffprobe`.
4. Add short-lived download storage and automatic deletion.
5. Add resource, abuse, copyright and identity-safety limits.

## Demo scenario

The clearest 90-second demonstration is:

> "Turn these rough project notes into a six-slide executive update, speaker
> notes and an action-register spreadsheet for tomorrow's management meeting."

Show the one paid request, the real PPTX opening correctly, speaker notes,
spreadsheet actions, verified source facts and the time saved. A second short
Study example can show authorized course notes becoming a grounded presentation
with citations and a revision calendar.

## Definition of done

The feature is not complete because JSON says a file was created. It is complete
only when:

- the endpoint is x402-protected and publicly callable;
- the returned files open in their target applications;
- layouts have passed automated and visual checks;
- factual claims are traceable to supplied evidence;
- security and integrity gates run before payment;
- failure modes are explicit and safe;
- the landing page contains a real example; and
- a paid production call has been completed and verified.

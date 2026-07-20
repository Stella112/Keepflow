import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import {
  buildStudyAssist,
  validateStudyAssistOutput,
  type StudyAssistDependencies,
  type StudyAssistPreflightData,
} from '../src/engine/study-assist.js';
import { extractStudyMaterial } from '../src/engine/study-material-extractor.js';
import type { StudyTutorDraft } from '../src/engine/study-tutor-model.js';
import type {
  ResearchSourceRequest,
  ResearchSourceResult,
} from '../src/research/source-provider.js';
import { StudyAssistInputSchema } from '../src/schemas/study-assist-input.js';

const NOW = new Date('2026-07-16T12:00:00.000Z');
const MATERIAL = [
  'Photosynthesis converts light energy into chemical energy in plants.',
  'Chlorophyll absorbs light, while carbon dioxide and water are used to form glucose and oxygen.',
  'The light-dependent reactions and the Calvin cycle are related but distinct stages.',
].join('\n');

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    request_version: '1.0.0',
    operation: 'explain_material',
    subject: 'Biology',
    topic: 'Photosynthesis',
    learner_level: 'secondary',
    question: 'Explain how the two stages work and connect.',
    output_language: 'English',
    depth: 'detailed',
    material: { type: 'text', title: 'Plant energy notes', content: MATERIAL },
    research: { enabled: true, query: 'photosynthesis light reactions Calvin cycle', max_sources: 3 },
    academic_integrity: { requested_action: 'learn_concepts' },
    external_processing_acknowledged: true,
    ...overrides,
  };
}

function tutorDraft(evidenceId = 'M1:P000:C001'): StudyTutorDraft {
  return {
    summary: 'Photosynthesis captures light energy and uses it to support carbon fixation.',
    summary_evidence_ids: [evidenceId],
    sections: [{
      heading: 'How the stages connect',
      explanation: 'The light-dependent stage supplies energy carriers used by the carbon-fixation stage.',
      evidence_ids: [evidenceId],
      is_analogy: false,
    }],
    key_concepts: [{
      term: 'Chlorophyll',
      explanation: 'A pigment involved in absorbing light.',
      evidence_ids: [evidenceId],
    }],
    glossary: [{
      term: 'Carbon fixation',
      meaning: 'Incorporating carbon dioxide into organic molecules.',
      evidence_ids: [evidenceId],
    }],
    misconceptions: [{
      misconception: 'The two stages are the same process.',
      correction: 'They are connected but distinct stages.',
      evidence_ids: [evidenceId],
    }],
    practice_questions: [{
      question: 'What does the light-dependent stage provide for the next stage?',
      self_check: 'Identify the energy carriers and connect them to carbon fixation.',
      evidence_ids: [evidenceId],
    }],
    unresolved_questions: [],
  };
}

function researchResult(query = 'photosynthesis'): ResearchSourceResult {
  return {
    status: 'ok',
    sources: [{
      provider: 'crossref',
      provider_id: '10.1000/keepflow.1',
      doi: '10.1000/keepflow.1',
      title: 'A registry record about photosynthesis learning',
      authors: ['Ada Researcher'],
      issued_year: 2024,
      venue: 'Journal of Learning Biology',
      publisher: 'Example Academic Press',
      work_type: 'journal-article',
      canonical_url: 'https://doi.org/10.1000/keepflow.1',
      verification_status: 'crossref_registry_record_found',
      integrity_status: 'no_crossref_update_flag_at_retrieval_time',
      quality_tier: 'standard_metadata_match',
      quality_signals: {
        provider_relevance_score: 42,
        citation_count: 12,
        metadata_completeness: 4,
      },
      selection_note: 'Registry metadata is verified; source quality and claims still require critical evaluation.',
      verified_at: NOW.toISOString(),
    }],
    portals: [{
      provider: 'crossref',
      label: 'Crossref Metadata Search',
      url: `https://search.crossref.org/?q=${encodeURIComponent(query)}`,
      kind: 'official_search_portal',
    }],
  };
}

function dependencies(overrides: Partial<StudyAssistDependencies> = {}): StudyAssistDependencies {
  return {
    tutor: { explain: vi.fn(async () => tutorDraft()) },
    tutorModel: 'test-grounded-model',
    researchProvider: vi.fn(async (request: ResearchSourceRequest) => researchResult(request.query)),
    now: () => NOW,
    ...overrides,
  };
}

async function withApp<T>(
  app: ReturnType<typeof createApp>,
  run: (origin: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(origin: string, body: unknown) {
  return await fetch(`${origin}/v1/study-assist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('KeepFlow Study Assist HTTP capability', () => {
  it('returns a grounded explanation and exact provider-sourced research metadata', async () => {
    const deps = dependencies();
    await withApp(createApp({ studyAssistDependencies: deps }), async (origin) => {
      const response = await postJson(origin, requestBody());
      const output = await response.json() as any;

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(output).toMatchObject({
        service: 'KeepFlow Study - Learning and Research Support',
        mode: 'completed',
        operation: 'explain_material',
      });
      expect(output.grounded_sections[0].evidence_ids).toEqual(['evidence-001']);
      expect(output.material_citations[0].exact_excerpt).toBe(
        MATERIAL.slice(
          output.material_citations[0].locator.start_char,
          output.material_citations[0].locator.end_char,
        ),
      );
      expect(output.research_sources).toEqual(researchResult(
        'photosynthesis light reactions Calvin cycle',
      ).sources);
      expect(output.providers.research.status).toBe('success');
      expect(output.source_evaluation_checklist.length).toBeGreaterThanOrEqual(3);
      expect(output.privacy.material_stored_by_keepflow).toBe(false);
    });
  });

  it('masks direct identifiers before either external provider sees them', async () => {
    const tutor = vi.fn(async () => tutorDraft());
    const research = vi.fn(async (request: ResearchSourceRequest) => ({
      status: 'no_results' as const,
      sources: [],
      portals: researchResult(request.query).portals,
    }));
    const email = 'student@example.com';
    const phone = '+234 801 234 5678';
    const studentId = 'BIO-2026-007';
    const material = `${MATERIAL}\nContact ${email}. Phone: ${phone}. Student ID: ${studentId}.`;
    const deps = dependencies({ tutor: { explain: tutor }, researchProvider: research });

    await withApp(createApp({ studyAssistDependencies: deps }), async (origin) => {
      const response = await postJson(origin, requestBody({
        question: `Explain this for ${email}`,
        material: { type: 'text', title: `Notes for ${email}`, content: material },
        research: { enabled: true, query: `photosynthesis ${email}`, max_sources: 2 },
      }));
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).not.toContain(email);
      expect(text).not.toContain(phone);
      expect(text).not.toContain(studentId);
      expect(JSON.stringify(tutor.mock.calls)).not.toContain(email);
      expect(JSON.stringify(tutor.mock.calls)).not.toContain(phone);
      expect(JSON.stringify(tutor.mock.calls)).not.toContain(studentId);
      expect(JSON.stringify(research.mock.calls)).not.toContain(email);
      expect(text).toContain('email');
      expect(text).toContain('phone');
      expect(text).toContain('student_id');
    });
  });

  it('rejects secret-bearing uploads before payment or provider contact and never echoes the secret', async () => {
    const tutor = vi.fn(async () => tutorDraft());
    const research = vi.fn(async () => researchResult());
    const secret = `sk-${'a'.repeat(40)}`;
    const previous = { ...config.payments };
    config.payments.enabled = true;
    config.payments.okxConfigured = false;
    config.payments.payToAddress = undefined;
    const app = createApp({
      studyAssistDependencies: dependencies({ tutor: { explain: tutor }, researchProvider: research }),
    });
    Object.assign(config.payments, previous);

    await withApp(app, async (origin) => {
      const response = await postJson(origin, requestBody({
        material: {
          type: 'text',
          title: 'Unsafe notes',
          content: `${MATERIAL}\nAPI token: ${secret}`,
        },
      }));
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(text).toContain('sensitive_data_detected');
      expect(text).not.toContain(secret);
      expect(tutor).not.toHaveBeenCalled();
      expect(research).not.toHaveBeenCalled();
    });
  });

  it.each([
    'produce_submission',
    'take_live_assessment',
    'impersonate_learner',
  ] as const)('redirects %s before payment, extraction spend, or provider contact', async (action) => {
    const tutor = vi.fn(async () => tutorDraft());
    const research = vi.fn(async () => researchResult());
    await withApp(createApp({
      studyAssistDependencies: dependencies({ tutor: { explain: tutor }, researchProvider: research }),
    }), async (origin) => {
      const response = await postJson(origin, requestBody({
        academic_integrity: { requested_action: action },
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'academic_integrity_redirect' });
      expect(tutor).not.toHaveBeenCalled();
      expect(research).not.toHaveBeenCalled();
    });
  });

  it('catches a prohibited request concealed behind an allowed action label', async () => {
    const tutor = vi.fn(async () => tutorDraft());
    const research = vi.fn(async () => researchResult());
    await withApp(createApp({
      studyAssistDependencies: dependencies({ tutor: { explain: tutor }, researchProvider: research }),
    }), async (origin) => {
      const response = await postJson(origin, requestBody({
        question: 'Write my graded assignment for me and make it ready to submit.',
        academic_integrity: { requested_action: 'learn_concepts' },
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: 'academic_integrity_redirect',
        reason: 'submission_production_blocked',
      });
      expect(tutor).not.toHaveBeenCalled();
      expect(research).not.toHaveBeenCalled();
    });
  });

  it('does not contact the tutor or research provider before successful payment middleware', async () => {
    const tutor = vi.fn(async () => tutorDraft());
    const research = vi.fn(async () => researchResult());
    const previous = { ...config.payments };
    config.payments.enabled = true;
    config.payments.okxConfigured = false;
    config.payments.payToAddress = undefined;
    const app = createApp({
      studyAssistDependencies: dependencies({ tutor: { explain: tutor }, researchProvider: research }),
    });
    Object.assign(config.payments, previous);

    await withApp(app, async (origin) => {
      const response = await postJson(origin, requestBody());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'payment_misconfigured' });
      expect(tutor).not.toHaveBeenCalled();
      expect(research).not.toHaveBeenCalled();
    });
  });

  it('returns an honest grounded source-map fallback when the tutor is unavailable', async () => {
    const deps = dependencies({ tutor: null, tutorModel: null });
    await withApp(createApp({ studyAssistDependencies: deps }), async (origin) => {
      const response = await postJson(origin, requestBody({ research: { enabled: false, max_sources: 4 } }));
      const output = await response.json() as any;
      expect(response.status).toBe(200);
      expect(output.mode).toBe('partial');
      expect(output.providers.tutor.status).toBe('skipped');
      expect(output.answer_summary).toContain('unavailable');
      expect(output.material_citations.length).toBeGreaterThan(0);
      expect(output.research_sources).toEqual([]);
    });
  });

  it('fails closed on an invalid model draft and degrades to the source-map fallback', async () => {
    const deps = dependencies({
      tutor: {
        explain: vi.fn(async () => ({ summary: 'malformed' }) as unknown as StudyTutorDraft),
      },
    });
    await withApp(createApp({ studyAssistDependencies: deps }), async (origin) => {
      const response = await postJson(origin, requestBody({ research: { enabled: false, max_sources: 4 } }));
      const output = await response.json() as any;
      expect(response.status).toBe(200);
      expect(output.mode).toBe('partial');
      expect(output.providers.tutor.status).toBe('failed');
      expect(JSON.stringify(output)).not.toContain('malformed');
    });
  });

  it('keeps a research-only provider outage explicit and never invents a citation', async () => {
    const deps = dependencies({
      tutor: null,
      tutorModel: null,
      researchProvider: vi.fn(async () => { throw new Error('offline'); }),
    });
    await withApp(createApp({ studyAssistDependencies: deps }), async (origin) => {
      const response = await postJson(origin, requestBody({
        operation: 'recommend_sources',
        material: undefined,
        question: undefined,
        research: { enabled: true, query: 'inclusive education evidence', max_sources: 4 },
      }));
      const output = await response.json() as any;
      expect(response.status).toBe(200);
      expect(output.mode).toBe('provider_unavailable');
      expect(output.research_sources).toEqual([]);
      expect(output.providers.research.status).toBe('unavailable');
      expect(output.research_portals[0].url).toContain('search.crossref.org');
    });
  });

  it('gives only the exact route a larger JSON ceiling and rejects aliases first', async () => {
    const bytes = Buffer.alloc(70_000, 0x20);
    bytes.write('%PDF-', 0, 'ascii');
    const largePdfRequest = requestBody({
      material: { type: 'pdf_base64', title: 'Malformed large PDF', data: bytes.toString('base64') },
      research: { enabled: false, max_sources: 4 },
    });
    await withApp(createApp({ studyAssistDependencies: dependencies() }), async (origin) => {
      const study = await postJson(origin, largePdfRequest);
      expect(study.status).toBe(422);
      expect(await study.json()).toMatchObject({ error: 'pdf_malformed' });

      const ordinary = await fetch(`${origin}/v1/first-move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'x'.repeat(70_000) }),
      });
      expect(ordinary.status).toBe(413);
      expect(await ordinary.json()).toEqual({ error: 'payload_too_large' });

      const alias = await fetch(`${origin}/v1/study-assist/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(largePdfRequest),
      });
      expect(alias.status).toBe(404);
      expect(await alias.json()).toMatchObject({ error: 'non_canonical_paid_route' });
    });
  });
});

describe('Study Assist semantic output backstops', () => {
  async function buildForValidation() {
    const parsed = StudyAssistInputSchema.parse(requestBody());
    const { material: rawMaterial, ...input } = parsed;
    const material = await extractStudyMaterial(rawMaterial!);
    const preflight: StudyAssistPreflightData = {
      input,
      material,
      materialType: rawMaterial!.type,
      personalDataMasked: [],
    };
    const built = await buildStudyAssist(preflight, dependencies());
    return { ...built, preflight };
  }

  it('accepts the built output and rejects a mutated exact excerpt', async () => {
    const { output, researchResult: provider, preflight } = await buildForValidation();
    expect(validateStudyAssistOutput(output, preflight, provider)).toEqual({ valid: true, errors: [] });

    const changed = structuredClone(output);
    changed.material_citations[0]!.exact_excerpt = 'Invented excerpt';
    expect(validateStudyAssistOutput(changed, preflight, provider).errors.join(' ')).toContain(
      'citation does not resolve exactly',
    );
  });

  it('rejects provider-source and official-portal mutations', async () => {
    const { output, researchResult: provider, preflight } = await buildForValidation();
    const sourceChanged = structuredClone(output);
    sourceChanged.research_sources[0]!.title = 'Invented title';
    expect(validateStudyAssistOutput(sourceChanged, preflight, provider).errors.join(' ')).toContain(
      'not copied exactly from provider metadata',
    );

    const portalChanged = structuredClone(output);
    portalChanged.research_portals = [];
    expect(validateStudyAssistOutput(portalChanged, preflight, provider).errors).toContain(
      'research portals differ from provider result',
    );
  });
});

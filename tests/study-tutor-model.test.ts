import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, type Config } from '../src/config.js';
import {
  createStudyTutor,
  studyTutorAttemptTimeoutMs,
  StudyTutorDraftSchema,
  validateStudyTutorDraft,
  type StudyTutorDraft,
  type TutorMaterialChunk,
} from '../src/engine/study-tutor-model.js';

const chunks: TutorMaterialChunk[] = [
  {
    id: 'M1:P001:C001',
    page: 1,
    lineStart: 1,
    lineEnd: 8,
    text: 'Plants absorb light energy, which supports the reactions described in the material.',
  },
  {
    id: 'M1:P001:C002',
    page: 1,
    lineStart: 9,
    lineEnd: 16,
    text: 'The material distinguishes energy capture from the later production of sugars.',
  },
];

function validDraft(): StudyTutorDraft {
  return {
    summary:
      'The supplied material explains how plants capture light energy and use it during photosynthesis.',
    summary_evidence_ids: ['M1:P001:C001'],
    sections: [
      {
        heading: 'Energy capture',
        explanation:
          'The first cited passage connects absorbed light with the energy needed for the described reactions.',
        evidence_ids: ['M1:P001:C001'],
        is_analogy: false,
      },
      {
        heading: 'A simple analogy',
        explanation:
          'As an analogy, energy capture is like charging a battery before that stored energy is used.',
        evidence_ids: ['M1:P001:C001', 'M1:P001:C002'],
        is_analogy: true,
      },
    ],
    key_concepts: [
      {
        term: 'Photosynthesis',
        explanation: 'A process in which captured light energy supports the production described in the notes.',
        evidence_ids: ['M1:P001:C001', 'M1:P001:C002'],
      },
    ],
    glossary: [
      {
        term: 'Light energy',
        meaning: 'The energy source identified in the supplied passage.',
        evidence_ids: ['M1:P001:C001'],
      },
    ],
    misconceptions: [{
      misconception: 'Capturing light and producing sugars are the same step.',
      correction: 'The material presents them as connected but distinct stages.',
      evidence_ids: ['M1:P001:C001'],
    }],
    practice_questions: [
      {
        question: 'What role does captured light energy have in the process?',
        self_check: 'Your answer should distinguish energy capture from the later production step.',
        evidence_ids: ['M1:P001:C001', 'M1:P001:C002'],
      },
    ],
    unresolved_questions: ['The supplied excerpts do not name every intermediate reaction.'],
  };
}

function cloneDraft(): StudyTutorDraft {
  return structuredClone(validDraft());
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Study tutor model contract', () => {
  it('keeps two tutor attempts within the paid client response window', () => {
    expect(studyTutorAttemptTimeoutMs(25_000, 1)).toBe(18_000);
    expect(studyTutorAttemptTimeoutMs(25_000, 2)).toBe(6_000);
    expect(studyTutorAttemptTimeoutMs(5_000, 1)).toBe(5_000);
    expect(studyTutorAttemptTimeoutMs(150, 2)).toBe(150);
  });

  it('accepts a bounded structured draft whose evidence exists in the catalog', () => {
    const parsed = StudyTutorDraftSchema.safeParse(validDraft());

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(validateStudyTutorDraft(parsed.data, chunks)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['summary', (draft: StudyTutorDraft) => { draft.summary_evidence_ids = ['M1:P999:C001']; }],
    ['section', (draft: StudyTutorDraft) => { draft.sections[0]!.evidence_ids = ['M1:P001:C999']; }],
    ['concept', (draft: StudyTutorDraft) => { draft.key_concepts[0]!.evidence_ids = ['M1:P777:C777']; }],
    ['glossary', (draft: StudyTutorDraft) => { draft.glossary[0]!.evidence_ids = ['M1:P222:C002']; }],
    ['misconception', (draft: StudyTutorDraft) => { draft.misconceptions[0]!.evidence_ids = ['M1:P333:C003']; }],
    ['practice question', (draft: StudyTutorDraft) => { draft.practice_questions[0]!.evidence_ids = ['M1:P123:C123']; }],
  ])('rejects a nonexistent %s evidence reference', (_label, mutate) => {
    const draft = cloneDraft();
    mutate(draft);

    const validation = validateStudyTutorDraft(draft, chunks);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveLength(1);
    expect(validation.errors[0]).toMatch(/^unknown evidence id: M1:P\d{3}:C\d{3}$/);
  });

  it.each([
    'See https://fabricated.example/research for proof.',
    'The supposed source has DOI: 10.1234/fabricated.5678.',
    'This assertion comes from 10.5555/not-a-real-paper.',
  ])('rejects model-authored URL or DOI text: %s', (fabricatedCitation) => {
    const draft = cloneDraft();
    draft.sections[0]!.explanation = fabricatedCitation;

    const validation = validateStudyTutorDraft(draft, chunks);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('model-authored citation or URL text is prohibited');
  });

  it('rejects secret-shaped model output without echoing the secret in errors', () => {
    const secret = 'api_key=live_customer_service_token_123456789';
    const draft = cloneDraft();
    draft.sections[0]!.explanation = `The material contains ${secret}, which must never be returned.`;

    const validation = validateStudyTutorDraft(draft, chunks);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('secret-shaped model output is prohibited');
    expect(validation.errors.join(' ')).not.toContain(secret);
  });

  it.each([
    ['non-boolean analogy marker', (draft: Record<string, any>) => { draft.sections[0].is_analogy = 'yes'; }],
    ['missing analogy marker', (draft: Record<string, any>) => { delete draft.sections[0].is_analogy; }],
    ['empty evidence list', (draft: Record<string, any>) => { draft.sections[0].evidence_ids = []; }],
    ['malformed evidence id', (draft: Record<string, any>) => { draft.sections[0].evidence_ids = ['page-one']; }],
    [
      'too many evidence ids',
      (draft: Record<string, any>) => {
        draft.sections[0].evidence_ids = [
          'M1:P001:C001',
          'M1:P001:C002',
          'M1:P001:C003',
          'M1:P001:C004',
          'M1:P001:C005',
        ];
      },
    ],
    ['missing glossary evidence', (draft: Record<string, any>) => { delete draft.glossary[0].evidence_ids; }],
    ['missing misconception evidence', (draft: Record<string, any>) => { delete draft.misconceptions[0].evidence_ids; }],
  ])('schema rejects an invalid %s shape', (_label, mutate) => {
    const draft = structuredClone(validDraft()) as unknown as Record<string, any>;
    mutate(draft);
    expect(StudyTutorDraftSchema.safeParse(draft).success).toBe(false);
  });

  it('keeps the model disabled when its feature flag or API key is missing', () => {
    const featureDisabled: Config = {
      ...config,
      studyAssistant: {
        ...config.studyAssistant,
        enabled: false,
        apiKey: 'not-a-real-key',
      },
    };
    const keyMissing: Config = {
      ...config,
      studyAssistant: {
        ...config.studyAssistant,
        enabled: true,
        apiKey: undefined,
      },
    };

    expect(createStudyTutor(featureDisabled)).toBeNull();
    expect(createStudyTutor(keyMissing)).toBeNull();
  });

  it('retries one provider failure and returns the second grounded response', async () => {
    const responseBody = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [{
        type: 'tool_use',
        id: 'tool_test',
        name: 'record_grounded_explanation',
        input: validDraft(),
      }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'temporary' } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify(responseBody),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const tutor = createStudyTutor({
      ...config,
      studyAssistant: {
        ...config.studyAssistant,
        enabled: true,
        apiKey: 'test-key',
        model: 'claude-haiku-4-5',
      },
    });

    const result = await tutor!.explain({
      operation: 'practice_questions',
      subject: 'Biology',
      topic: 'Photosynthesis',
      learnerLevel: 'undergraduate',
      question: 'Create practice questions.',
      outputLanguage: 'English',
      explanationDepth: 'standard',
      chunks,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(validDraft());
  });

  it('logs only safe failure fields when both provider attempts fail', async () => {
    const secret = 'private-material-do-not-log';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ type: 'error', error: { type: 'api_error', message: secret } }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tutor = createStudyTutor({
      ...config,
      studyAssistant: {
        ...config.studyAssistant,
        enabled: true,
        apiKey: 'test-key',
        model: 'claude-haiku-4-5',
      },
    });

    const result = await tutor!.explain({
      operation: 'practice_questions',
      subject: 'Geology',
      topic: 'Plate tectonics',
      learnerLevel: 'undergraduate',
      question: 'Create practice questions.',
      outputLanguage: 'English',
      explanationDepth: 'standard',
      chunks,
    });

    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(`${JSON.stringify(logSpy.mock.calls)}${JSON.stringify(errorSpy.mock.calls)}`)
      .not.toContain(secret);
  });
});

import { describe, expect, it } from 'vitest';
import {
  STUDY_ASSIST_MAX_PDF_BYTES,
  StudyAssistInputSchema,
} from '../src/schemas/study-assist-input.js';
import { StudyAssistOutputSchema } from '../src/schemas/study-assist-output.js';

function textMaterial() {
  return {
    type: 'text' as const,
    title: 'Cell division lecture notes',
    content:
      'Mitosis is a process of nuclear division that produces two nuclei with the same chromosome complement. ' +
      'The notes distinguish prophase, metaphase, anaphase, and telophase before cytokinesis.',
  };
}

function textInput() {
  return {
    operation: 'explain_material' as const,
    subject: 'Biology',
    topic: 'Mitosis and the cell cycle',
    learner_level: 'undergraduate' as const,
    question: 'Explain why chromosome alignment matters before separation.',
    output_language: 'English',
    depth: 'detailed' as const,
    material: textMaterial(),
    research: { enabled: false },
    academic_integrity: { requested_action: 'learn_concepts' as const },
    external_processing_acknowledged: true as const,
  };
}

function materialOutput() {
  return {
    service: 'KeepFlow Study - Learning and Research Support' as const,
    response_version: '1.0.0' as const,
    operation: 'explain_material' as const,
    mode: 'completed' as const,
    subject: 'Biology',
    topic: 'Mitosis and the cell cycle',
    output_language: 'English',
    answer_summary: 'Chromosome alignment creates a checkpoint before sister chromatids separate.',
    answer_summary_evidence_ids: ['evidence-001'],
    material_coverage: [{
      material_id: 'material-001' as const,
      title: 'Cell division lecture notes',
      material_type: 'text' as const,
      extracted_characters: 188,
      analyzed_characters: 188,
      page_count: null,
      truncated: false,
      statement: 'The complete supplied text was available for grounding.',
    }],
    grounded_sections: [{
      section_id: 'section-001',
      heading: 'Alignment before separation',
      explanation: 'The supplied notes place metaphase before anaphase, preserving the declared stage order.',
      is_analogy: false,
      evidence_ids: ['evidence-001'],
    }],
    material_citations: [{
      citation_id: 'citation-001',
      evidence_id: 'evidence-001',
      material_id: 'material-001' as const,
      locator: { type: 'text_range' as const, start_char: 106, end_char: 171 },
      exact_excerpt: 'The notes distinguish prophase, metaphase, anaphase, and telophase',
    }],
    key_concepts: [{
      concept: 'Metaphase',
      explanation: 'The stage identified immediately before anaphase in the supplied notes.',
      evidence_ids: ['evidence-001'],
    }],
    glossary: [{
      term: 'Anaphase',
      definition: 'The stage following metaphase in the supplied ordering.',
      evidence_ids: ['evidence-001'],
    }],
    misconceptions: [{
      misconception: 'Metaphase and anaphase are interchangeable stage names.',
      correction: 'The supplied notes place metaphase before anaphase as distinct stages.',
      evidence_ids: ['evidence-001'],
    }],
    practice_questions: [{
      question_id: 'practice-001',
      prompt: 'What ordering relationship between metaphase and anaphase appears in the notes?',
      answer_guidance: 'Identify the two stages in the exact sequence stated by the source.',
      evidence_ids: ['evidence-001'],
      novel_not_from_assessment: true as const,
    }],
    research_sources: [],
    research_portals: [],
    source_evaluation_checklist: [],
    providers: {
      tutor: {
        provider: 'Anthropic',
        model: 'configured-study-model',
        status: 'success' as const,
        statement: 'The configured tutor provider returned structured learning support.',
      },
      research: {
        provider: 'crossref' as const,
        status: 'not_requested' as const,
        retrieved_at: null,
        statement: 'External research was not requested.',
      },
    },
    integrity_controls: {
      status: 'compliant' as const,
      requested_action: 'learn_concepts',
      statement: 'The response explains concepts without producing assessed work.',
      disallowed_help: ['Completing assessed work as the learner'],
      safe_alternative: 'Use the explanation and novel practice question for legitimate study.',
    },
    clarifying_questions: [],
    assumptions: ['The uploaded notes are caller-provided and unverified.'],
    limitations: ['The service does not certify the accuracy of uploaded material.'],
    privacy: {
      stateless: true as const,
      material_stored_by_keepflow: false as const,
      conversation_stored_by_keepflow: false as const,
      external_processing_acknowledged: true as const,
      cache_control: 'no-store' as const,
      statement: 'KeepFlow does not retain the uploaded material or a conversation history.',
    },
    meta: {
      asp: 'KeepFlow' as const,
      schema_version: '1.0.0' as const,
      generated_at: '2026-07-16T12:00:00.000Z',
      stores_academic_data: false as const,
      external_ai_contacted: true,
      external_sources_used: false,
    },
  };
}

function researchOutput() {
  const value = materialOutput();
  return {
    ...value,
    operation: 'recommend_sources' as const,
    subject: 'Education',
    topic: 'Retrieval practice',
    answer_summary: 'One Crossref-indexed source matched the declared research query.',
    answer_summary_evidence_ids: [],
    material_coverage: [],
    grounded_sections: [],
    material_citations: [],
    key_concepts: [],
    glossary: [],
    misconceptions: [],
    practice_questions: [],
    research_sources: [{
      provider: 'crossref' as const,
      provider_id: '10.1000/xyz123',
      doi: '10.1000/xyz123',
      title: 'Retrieval Practice and Learning',
      authors: ['Ada Scholar'],
      issued_year: 2022,
      venue: 'Journal of Learning Research',
      publisher: 'Example Academic Press',
      work_type: 'journal-article',
      canonical_url: 'https://doi.org/10.1000/xyz123',
      verification_status: 'crossref_registry_record_found' as const,
      integrity_status: 'no_crossref_update_flag_at_retrieval_time' as const,
      verified_at: '2026-07-16T12:00:00.000Z',
    }],
    research_portals: [{
      provider: 'crossref' as const,
      label: 'Search Crossref metadata directly',
      url: 'https://search.crossref.org/?q=retrieval%20practice',
      kind: 'official_search_portal' as const,
    }],
    source_evaluation_checklist: [
      'Confirm that the full paper matches the research question.',
      'Check the venue and course source requirements.',
      'Inspect methods, limitations, corrections, and retractions.',
    ],
    providers: {
      tutor: {
        provider: 'Anthropic',
        model: null,
        status: 'not_requested' as const,
        statement: 'A tutor model was not required for metadata recommendations.',
      },
      research: {
        provider: 'crossref' as const,
        status: 'success' as const,
        retrieved_at: '2026-07-16T12:00:00.000Z',
        statement: 'Crossref returned verified work metadata.',
      },
    },
    meta: {
      ...value.meta,
      external_ai_contacted: false,
      external_sources_used: true,
    },
  };
}

describe('StudyAssistInputSchema', () => {
  it('accepts a bounded text-material explanation and applies safe defaults', () => {
    const parsed = StudyAssistInputSchema.parse(textInput());
    expect(parsed.request_version).toBe('1.0.0');
    expect(parsed.research).toEqual({ enabled: false, max_sources: 4 });
    expect(parsed.material?.type).toBe('text');
  });

  it('accepts canonical PDF base64 at exactly the one-MiB decoded limit', () => {
    const parsed = StudyAssistInputSchema.safeParse({
      ...textInput(),
      material: {
        type: 'pdf_base64',
        title: 'Large course reader',
        data: Buffer.alloc(STUDY_ASSIST_MAX_PDF_BYTES).toString('base64'),
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects decoded PDF data larger than one MiB', () => {
    const parsed = StudyAssistInputSchema.safeParse({
      ...textInput(),
      material: {
        type: 'pdf_base64',
        title: 'Oversized reader',
        data: Buffer.alloc(STUDY_ASSIST_MAX_PDF_BYTES + 1).toString('base64'),
      },
    });
    expect(parsed.success).toBe(false);
  });

  it.each([
    'data:application/pdf;base64,JVBERi0xLjQ=',
    'JVBE Ri0x',
    'abcd-_==',
    'Zh==',
  ])('rejects non-canonical base64: %s', (data) => {
    expect(StudyAssistInputSchema.safeParse({
      ...textInput(),
      material: { type: 'pdf_base64', title: 'Reader', data },
    }).success).toBe(false);
  });

  it.each(['explain_material', 'summarize_material', 'practice_questions'] as const)(
    'requires material for %s',
    (operation) => {
      const value = { ...textInput(), operation };
      delete (value as { material?: unknown }).material;
      expect(StudyAssistInputSchema.safeParse(value).success).toBe(false);
    },
  );

  it('allows source recommendations without material only when research and a query are enabled', () => {
    const value = {
      ...textInput(),
      operation: 'recommend_sources' as const,
      research: {
        enabled: true,
        query: 'retrieval practice learning outcomes',
        published_after_year: 2015,
        max_sources: 6,
      },
    };
    delete (value as { material?: unknown }).material;
    expect(StudyAssistInputSchema.safeParse(value).success).toBe(true);
    expect(StudyAssistInputSchema.safeParse({
      ...value,
      research: { enabled: false },
    }).success).toBe(false);
    expect(StudyAssistInputSchema.safeParse({
      ...value,
      research: { enabled: true },
    }).success).toBe(false);
  });

  it('rejects research filters when research is disabled', () => {
    expect(StudyAssistInputSchema.safeParse({
      ...textInput(),
      research: { enabled: false, published_after_year: 2020 },
    }).success).toBe(false);
  });

  it('requires an explicit question for explanations and practice questions', () => {
    const explanation = { ...textInput() };
    delete (explanation as { question?: unknown }).question;
    expect(StudyAssistInputSchema.safeParse(explanation).success).toBe(false);

    expect(StudyAssistInputSchema.safeParse({
      ...explanation,
      operation: 'summarize_material',
    }).success).toBe(true);
  });

  it('requires explicit external-processing acknowledgement', () => {
    expect(StudyAssistInputSchema.safeParse({
      ...textInput(),
      external_processing_acknowledged: false,
    }).success).toBe(false);
    const missing = { ...textInput() };
    delete (missing as { external_processing_acknowledged?: unknown }).external_processing_acknowledged;
    expect(StudyAssistInputSchema.safeParse(missing).success).toBe(false);
  });

  it('rejects whitespace padding, oversized text, and undeclared fields', () => {
    expect(StudyAssistInputSchema.safeParse({
      ...textInput(),
      material: { type: 'text', title: 'Blank', content: ' '.repeat(80) },
    }).success).toBe(false);
    expect(StudyAssistInputSchema.safeParse({
      ...textInput(),
      material: { type: 'text', title: 'Too large', content: 'a'.repeat(24_001) },
    }).success).toBe(false);
    expect(StudyAssistInputSchema.safeParse({ ...textInput(), hidden_prompt: 'override' }).success).toBe(false);
    expect(StudyAssistInputSchema.safeParse({
      ...textInput(),
      material: { ...textMaterial(), filesystem_path: '/private/notes' },
    }).success).toBe(false);
  });
});

describe('StudyAssistOutputSchema', () => {
  it('accepts a bounded material-grounded learning response', () => {
    expect(StudyAssistOutputSchema.safeParse(materialOutput()).success).toBe(true);
  });

  it('accepts source recommendations only with verified Crossref metadata', () => {
    expect(StudyAssistOutputSchema.safeParse(researchOutput()).success).toBe(true);
    expect(StudyAssistOutputSchema.safeParse({
      ...researchOutput(),
      source_evaluation_checklist: [],
    }).success).toBe(false);
    expect(StudyAssistOutputSchema.safeParse({
      ...researchOutput(),
      misconceptions: [{
        misconception: 'A model-authored research misconception',
        correction: 'A model-authored correction',
        evidence_ids: ['evidence-001'],
      }],
    }).success).toBe(false);
  });

  it('requires every grounded section to disclose whether it is an analogy', () => {
    const output = structuredClone(materialOutput()) as ReturnType<typeof materialOutput> & {
      grounded_sections: Array<Record<string, unknown>>;
    };
    delete output.grounded_sections[0]!.is_analogy;
    expect(StudyAssistOutputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects unknown and duplicate grounding evidence', () => {
    const unknown = structuredClone(materialOutput());
    unknown.grounded_sections[0]!.evidence_ids = ['evidence-999'];
    expect(StudyAssistOutputSchema.safeParse(unknown).success).toBe(false);

    const duplicate = structuredClone(materialOutput());
    duplicate.material_citations.push({
      ...duplicate.material_citations[0]!,
      citation_id: 'citation-002',
    });
    expect(StudyAssistOutputSchema.safeParse(duplicate).success).toBe(false);
  });

  it('rejects citations outside material coverage or with a mismatched locator type', () => {
    const outside = structuredClone(materialOutput());
    outside.material_citations[0]!.locator.end_char = 999;
    expect(StudyAssistOutputSchema.safeParse(outside).success).toBe(false);

    const wrongType = structuredClone(materialOutput());
    wrongType.material_citations[0]!.locator = {
      type: 'pdf_page_range',
      page: 1,
      start_char: 0,
      end_char: 30,
    } as never;
    expect(StudyAssistOutputSchema.safeParse(wrongType).success).toBe(false);
  });

  it('rejects a source whose canonical URL does not match its DOI', () => {
    const output = structuredClone(researchOutput());
    output.research_sources[0]!.canonical_url = 'https://doi.org/10.1000/different';
    expect(StudyAssistOutputSchema.safeParse(output).success).toBe(false);
  });

  it('accepts an encoded canonical DOI path containing parentheses', () => {
    const output = structuredClone(researchOutput());
    output.research_sources[0]!.provider_id = '10.1000/xyz(123)';
    output.research_sources[0]!.doi = '10.1000/xyz(123)';
    output.research_sources[0]!.canonical_url = 'https://doi.org/10.1000/xyz%28123%29';
    expect(StudyAssistOutputSchema.safeParse(output).success).toBe(true);
  });

  it('allows only provider-matched official HTTPS research portals', () => {
    const official = researchOutput();
    official.research_portals.push({
      provider: 'eric',
      label: 'Search the ERIC education index',
      url: 'https://eric.ed.gov/?q=retrieval%20practice',
      kind: 'official_search_portal',
    });
    official.research_portals.push({
      provider: 'pubmed',
      label: 'Search PubMed',
      url: 'https://pubmed.ncbi.nlm.nih.gov/?term=retrieval%20practice',
      kind: 'official_search_portal',
    });
    expect(StudyAssistOutputSchema.safeParse(official).success).toBe(true);

    expect(StudyAssistOutputSchema.safeParse({
      ...researchOutput(),
      research_portals: [{
        provider: 'crossref',
        label: 'Spoofed portal',
        url: 'https://search.crossref.org.attacker.example/?q=notes',
        kind: 'official_search_portal',
      }],
    }).success).toBe(false);
    expect(StudyAssistOutputSchema.safeParse({
      ...researchOutput(),
      research_portals: [{
        provider: 'pubmed',
        label: 'Provider mismatch',
        url: 'https://eric.ed.gov/',
        kind: 'official_search_portal',
      }],
    }).success).toBe(false);
  });

  it('rejects completed material help without exact citations', () => {
    const output = structuredClone(materialOutput());
    output.material_citations = [];
    output.grounded_sections = [];
    output.key_concepts = [];
    output.glossary = [];
    output.misconceptions = [];
    output.practice_questions = [];
    expect(StudyAssistOutputSchema.safeParse(output).success).toBe(false);
  });

  it('accepts an empty deterministic integrity redirect and rejects generated content in it', () => {
    const redirect = {
      ...materialOutput(),
      mode: 'integrity_redirect' as const,
      answer_summary_evidence_ids: [],
      material_coverage: [],
      grounded_sections: [],
      material_citations: [],
      key_concepts: [],
      glossary: [],
      misconceptions: [],
      practice_questions: [],
      research_sources: [],
      research_portals: [],
      source_evaluation_checklist: [],
      providers: {
        tutor: {
          provider: 'Anthropic',
          model: null,
          status: 'skipped' as const,
          statement: 'The provider was skipped because the requested action was disallowed.',
        },
        research: {
          provider: 'crossref' as const,
          status: 'not_requested' as const,
          retrieved_at: null,
          statement: 'Research was not performed for a disallowed request.',
        },
      },
      integrity_controls: {
        ...materialOutput().integrity_controls,
        status: 'redirected' as const,
      },
      meta: {
        ...materialOutput().meta,
        external_ai_contacted: false,
      },
    };
    expect(StudyAssistOutputSchema.safeParse(redirect).success).toBe(true);

    const unsafe = structuredClone(redirect);
    unsafe.grounded_sections = materialOutput().grounded_sections;
    expect(StudyAssistOutputSchema.safeParse(unsafe).success).toBe(false);
  });

  it('keeps privacy/provider metadata strict and internally consistent', () => {
    expect(StudyAssistOutputSchema.safeParse({
      ...materialOutput(),
      privacy: { ...materialOutput().privacy, retained_upload_id: 'abc' },
    }).success).toBe(false);
    expect(StudyAssistOutputSchema.safeParse({
      ...materialOutput(),
      meta: { ...materialOutput().meta, external_ai_contacted: false },
    }).success).toBe(false);
    expect(StudyAssistOutputSchema.safeParse({
      ...researchOutput(),
      providers: {
        ...researchOutput().providers,
        research: { ...researchOutput().providers.research, status: 'failed' },
      },
    }).success).toBe(false);
  });
});

import { z } from 'zod';
import { StudyAssistOperationSchema } from './study-assist-input.js';

const BoundedText = z.string().trim().min(1).max(1_200);
const DetailText = z.string().trim().min(1).max(4_000);
const EvidenceId = z.string().regex(/^evidence-\d{3}$/);
const EvidenceIds = z.array(EvidenceId).min(1).max(8);
const MaterialId = z.literal('material-001');

const MaterialCoverageSchema = z
  .object({
    material_id: MaterialId,
    title: z.string().trim().min(1).max(160),
    material_type: z.enum(['text', 'pdf_base64']),
    extracted_characters: z.number().int().positive().max(250_000),
    analyzed_characters: z.number().int().positive().max(24_000),
    page_count: z.number().int().positive().max(2_000).nullable(),
    truncated: z.boolean(),
    statement: BoundedText,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.analyzed_characters > value.extracted_characters) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['analyzed_characters'],
        message: 'analyzed_characters must not exceed extracted_characters',
      });
    }
    if (value.material_type === 'text' && value.page_count !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['page_count'],
        message: 'text material must use a null page_count',
      });
    }
    if (value.material_type === 'pdf_base64' && value.page_count === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['page_count'],
        message: 'PDF material must report its extracted page count',
      });
    }
  });

const TextLocatorSchema = z
  .object({
    type: z.literal('text_range'),
    start_char: z.number().int().nonnegative().max(250_000),
    end_char: z.number().int().positive().max(250_000),
  })
  .strict();

const PdfLocatorSchema = z
  .object({
    type: z.literal('pdf_page_range'),
    page: z.number().int().positive().max(2_000),
    start_char: z.number().int().nonnegative().max(100_000),
    end_char: z.number().int().positive().max(100_000),
  })
  .strict();

const ExactMaterialCitationSchema = z
  .object({
    citation_id: z.string().regex(/^citation-\d{3}$/),
    evidence_id: EvidenceId,
    material_id: MaterialId,
    locator: z.discriminatedUnion('type', [TextLocatorSchema, PdfLocatorSchema]),
    exact_excerpt: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.locator.end_char <= value.locator.start_char) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locator', 'end_char'],
        message: 'citation end_char must be greater than start_char',
      });
    }
  });

const GroundedSectionSchema = z
  .object({
    section_id: z.string().regex(/^section-\d{3}$/),
    heading: z.string().trim().min(1).max(160),
    explanation: DetailText,
    is_analogy: z.boolean(),
    evidence_ids: EvidenceIds,
  })
  .strict();

const ConceptSchema = z
  .object({
    concept: z.string().trim().min(1).max(160),
    explanation: z.string().trim().min(1).max(1_200),
    evidence_ids: EvidenceIds,
  })
  .strict();

const GlossaryEntrySchema = z
  .object({
    term: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(1).max(800),
    evidence_ids: EvidenceIds,
  })
  .strict();

const MisconceptionSchema = z
  .object({
    misconception: z.string().trim().min(1).max(500),
    correction: z.string().trim().min(1).max(700),
    evidence_ids: EvidenceIds,
  })
  .strict();

const PracticeQuestionSchema = z
  .object({
    question_id: z.string().regex(/^practice-\d{3}$/),
    prompt: z.string().trim().min(3).max(1_000),
    answer_guidance: z.string().trim().min(3).max(1_200),
    evidence_ids: EvidenceIds,
    novel_not_from_assessment: z.literal(true),
  })
  .strict();

const DOI_RE = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;

const CrossrefSourceSchema = z
  .object({
    provider: z.literal('crossref'),
    provider_id: z.string().trim().min(1).max(300),
    doi: z.string().trim().min(7).max(200).regex(DOI_RE),
    title: z.string().trim().min(1).max(500),
    authors: z.array(z.string().trim().min(1).max(160)).max(30),
    issued_year: z.number().int().min(1500).max(2100).nullable(),
    venue: z.string().trim().min(1).max(300).nullable(),
    publisher: z.string().trim().min(1).max(300).nullable(),
    work_type: z.string().trim().min(1).max(100),
    canonical_url: z.string().trim().min(1).max(300).url(),
    verification_status: z.literal('crossref_registry_record_found'),
    integrity_status: z.literal('no_crossref_update_flag_at_retrieval_time'),
    verified_at: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let matchesCanonicalDoi = false;
    try {
      const parsed = new URL(value.canonical_url);
      const decodedPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      matchesCanonicalDoi =
        parsed.protocol === 'https:' &&
        parsed.hostname.toLowerCase() === 'doi.org' &&
        parsed.port === '' &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.search === '' &&
        parsed.hash === '' &&
        decodedPath.toLowerCase() === value.doi.toLowerCase();
    } catch {
      matchesCanonicalDoi = false;
    }
    if (!matchesCanonicalDoi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canonical_url'],
        message: 'canonical_url must be the doi.org URL for the verified DOI',
      });
    }
  });

const ProviderStatus = z.enum([
  'not_requested',
  'success',
  'unavailable',
  'failed',
  'skipped',
]);

const TutorProviderSchema = z
  .object({
    provider: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(120).nullable(),
    status: ProviderStatus,
    statement: BoundedText,
  })
  .strict();

const ResearchProviderSchema = z
  .object({
    provider: z.literal('crossref'),
    status: ProviderStatus,
    retrieved_at: z.string().datetime().nullable(),
    statement: BoundedText,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'success' && value.retrieved_at === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['retrieved_at'],
        message: 'successful research must report when metadata was retrieved',
      });
    }
    if (value.status === 'not_requested' && value.retrieved_at !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['retrieved_at'],
        message: 'research that was not requested must not report a retrieval time',
      });
    }
  });

const ResearchPortalSchema = z
  .object({
    provider: z.enum(['crossref', 'eric', 'pubmed']),
    label: z.string().trim().min(1).max(160),
    url: z.string().trim().min(1).max(500).url(),
    kind: z.literal('official_search_portal'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const officialHosts = {
      crossref: 'search.crossref.org',
      eric: 'eric.ed.gov',
      pubmed: 'pubmed.ncbi.nlm.nih.gov',
    } as const;
    let official = false;
    try {
      const parsed = new URL(value.url);
      official =
        parsed.protocol === 'https:' &&
        parsed.hostname.toLowerCase() === officialHosts[value.provider] &&
        parsed.port === '' &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.hash === '';
    } catch {
      official = false;
    }
    if (!official) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'research portal URL must use the provider\'s fixed official HTTPS host',
      });
    }
  });

export const StudyAssistOutputSchema = z
  .object({
    service: z.literal('KeepFlow Study - Learning and Research Support'),
    response_version: z.literal('1.0.0'),
    operation: StudyAssistOperationSchema,
    mode: z.enum([
      'completed',
      'partial',
      'needs_clarification',
      'integrity_redirect',
      'provider_unavailable',
    ]),
    subject: z.string().trim().min(1).max(160),
    topic: z.string().trim().min(2).max(240),
    output_language: z.string().trim().min(2).max(40),
    answer_summary: BoundedText,
    answer_summary_evidence_ids: z.array(EvidenceId).max(8),
    material_coverage: z.array(MaterialCoverageSchema).max(1),
    grounded_sections: z.array(GroundedSectionSchema).max(12),
    material_citations: z.array(ExactMaterialCitationSchema).max(30),
    key_concepts: z.array(ConceptSchema).max(16),
    glossary: z.array(GlossaryEntrySchema).max(20),
    misconceptions: z.array(MisconceptionSchema).max(12),
    practice_questions: z.array(PracticeQuestionSchema).max(12),
    research_sources: z.array(CrossrefSourceSchema).max(6),
    research_portals: z.array(ResearchPortalSchema).max(3),
    source_evaluation_checklist: z.array(z.string().trim().min(1).max(500)).max(8),
    providers: z
      .object({
        tutor: TutorProviderSchema,
        research: ResearchProviderSchema,
      })
      .strict(),
    integrity_controls: z
      .object({
        status: z.enum(['compliant', 'redirected']),
        requested_action: z.string().trim().min(1).max(80),
        statement: BoundedText,
        disallowed_help: z.array(z.string().trim().min(1).max(300)).max(8),
        safe_alternative: BoundedText,
      })
      .strict(),
    clarifying_questions: z.array(z.string().trim().min(3).max(500)).max(6),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(10),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
    privacy: z
      .object({
        stateless: z.literal(true),
        material_stored_by_keepflow: z.literal(false),
        conversation_stored_by_keepflow: z.literal(false),
        external_processing_acknowledged: z.literal(true),
        cache_control: z.literal('no-store'),
        statement: BoundedText,
      })
      .strict(),
    meta: z
      .object({
        asp: z.literal('KeepFlow'),
        schema_version: z.literal('1.0.0'),
        generated_at: z.string().datetime(),
        stores_academic_data: z.literal(false),
        external_ai_contacted: z.boolean(),
        external_sources_used: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const uniqueIds = (
      values: string[],
      path: (string | number)[],
      label: string,
    ): void => {
      const seen = new Set<string>();
      values.forEach((item, index) => {
        if (seen.has(item)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, index],
            message: `${label} must be unique`,
          });
        }
        seen.add(item);
      });
    };

    uniqueIds(value.grounded_sections.map((item) => item.section_id), ['grounded_sections'], 'section ids');
    uniqueIds(value.material_citations.map((item) => item.citation_id), ['material_citations'], 'citation ids');
    uniqueIds(value.research_sources.map((item) => item.provider_id), ['research_sources'], 'provider ids');
    uniqueIds(value.research_sources.map((item) => item.doi.toLowerCase()), ['research_sources'], 'source DOIs');
    uniqueIds(value.research_portals.map((item) => item.provider), ['research_portals'], 'research portal providers');
    uniqueIds(value.practice_questions.map((item) => item.question_id), ['practice_questions'], 'practice-question ids');

    const allEvidence = value.material_citations.map((item) => item.evidence_id);
    uniqueIds(allEvidence, ['material_citations'], 'material evidence ids');
    const knownEvidence = new Set(allEvidence);

    const evidenceConsumers: Array<{ path: (string | number)[]; ids: string[] }> = [
      {
        path: ['answer_summary_evidence_ids'],
        ids: value.answer_summary_evidence_ids,
      },
      ...value.grounded_sections.map((item, index) => ({
        path: ['grounded_sections', index, 'evidence_ids'],
        ids: item.evidence_ids,
      })),
      ...value.key_concepts.map((item, index) => ({
        path: ['key_concepts', index, 'evidence_ids'],
        ids: item.evidence_ids,
      })),
      ...value.glossary.map((item, index) => ({
        path: ['glossary', index, 'evidence_ids'],
        ids: item.evidence_ids,
      })),
      ...value.misconceptions.map((item, index) => ({
        path: ['misconceptions', index, 'evidence_ids'],
        ids: item.evidence_ids,
      })),
      ...value.practice_questions.map((item, index) => ({
        path: ['practice_questions', index, 'evidence_ids'],
        ids: item.evidence_ids,
      })),
    ];
    const referencedEvidence = new Set<string>();
    for (const consumer of evidenceConsumers) {
      consumer.ids.forEach((id, index) => {
        if (!knownEvidence.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...consumer.path, index],
            message: `unknown grounding evidence id: ${id}`,
          });
        } else {
          referencedEvidence.add(id);
        }
      });
    }
    allEvidence.forEach((id) => {
      if (!referencedEvidence.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['material_citations'],
          message: `grounding evidence is not referenced by any learning item: ${id}`,
        });
      }
    });

    const coverage = value.material_coverage[0];
    if (value.material_citations.length && !coverage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['material_coverage'],
        message: 'material citations require material coverage metadata',
      });
    }
    if (coverage) {
      value.material_citations.forEach((citation, index) => {
        const expectedLocator = coverage.material_type === 'text' ? 'text_range' : 'pdf_page_range';
        if (citation.locator.type !== expectedLocator) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['material_citations', index, 'locator', 'type'],
            message: 'citation locator must match the material type',
          });
        }
        if (
          citation.locator.type === 'text_range' &&
          citation.locator.end_char > coverage.extracted_characters
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['material_citations', index, 'locator', 'end_char'],
            message: 'text citation falls outside the extracted material',
          });
        }
        if (
          citation.locator.type === 'pdf_page_range' &&
          coverage.page_count !== null &&
          citation.locator.page > coverage.page_count
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['material_citations', index, 'locator', 'page'],
            message: 'PDF citation references a page outside the extracted material',
          });
        }
      });
    }

    if (value.mode === 'completed' && value.operation !== 'recommend_sources') {
      if (
        !coverage ||
        !value.grounded_sections.length ||
        !value.material_citations.length ||
        !value.answer_summary_evidence_ids.length
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mode'],
          message: 'completed material support requires coverage, grounded sections, and grounded exact material citations',
        });
      }
    }
    if (
      value.mode === 'completed' &&
      value.operation === 'recommend_sources' &&
      !value.research_sources.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['research_sources'],
        message: 'completed source recommendations require at least one verified source',
      });
    }

    if (value.mode === 'integrity_redirect') {
      const generatedCount =
        value.grounded_sections.length +
        value.material_citations.length +
        value.key_concepts.length +
        value.glossary.length +
        value.misconceptions.length +
        value.practice_questions.length +
        value.research_sources.length +
        value.research_portals.length +
        value.source_evaluation_checklist.length;
      if (
        generatedCount !== 0 ||
        value.answer_summary_evidence_ids.length !== 0 ||
        value.integrity_controls.status !== 'redirected'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mode'],
          message: 'integrity redirects must not contain generated learning or research content',
        });
      }
    }

    if (
      (value.operation === 'recommend_sources' || value.mode === 'provider_unavailable') &&
      value.answer_summary_evidence_ids.length !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['answer_summary_evidence_ids'],
        message: 'research-only and provider-unavailable summaries must not claim material grounding',
      });
    }

    if (
      (value.operation === 'recommend_sources' || value.mode === 'integrity_redirect') &&
      value.misconceptions.length !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['misconceptions'],
        message: 'research-only and integrity-redirect responses must not generate misconceptions coaching',
      });
    }

    if (value.research_sources.length && value.providers.research.status !== 'success') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providers', 'research', 'status'],
        message: 'verified research sources require a successful Crossref provider status',
      });
    }
    if (value.providers.research.status === 'not_requested' && value.research_sources.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['research_sources'],
        message: 'research sources cannot be returned when research was not requested',
      });
    }
    if (
      value.providers.research.status !== 'not_requested' &&
      value.mode !== 'integrity_redirect' &&
      value.source_evaluation_checklist.length < 3
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_evaluation_checklist'],
        message: 'research responses must include a source-evaluation checklist',
      });
    }

    const contacted = !['not_requested', 'skipped'].includes(value.providers.tutor.status);
    if (value.meta.external_ai_contacted !== contacted) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'external_ai_contacted'],
        message: 'external_ai_contacted must match the tutor provider status',
      });
    }
    if (value.meta.external_sources_used !== (value.research_sources.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'external_sources_used'],
        message: 'external_sources_used must match the returned verified-source list',
      });
    }
  });

export type StudyAssistOutput = z.infer<typeof StudyAssistOutputSchema>;

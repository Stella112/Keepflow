import type { StudyAssistInput } from '../schemas/study-assist-input.js';
import {
  StudyAssistOutputSchema,
  type StudyAssistOutput,
} from '../schemas/study-assist-output.js';
import type {
  ExtractedStudyMaterial,
  StudyMaterialChunk,
} from './study-material-extractor.js';
import {
  StudyTutorDraftSchema,
  validateStudyTutorDraft,
  type StudyTutor,
  type StudyTutorDraft,
} from './study-tutor-model.js';
import {
  recommendResearchSources,
  type CrossrefFetchOptions,
} from '../research/crossref.js';
import type {
  ResearchSourceRequest,
  ResearchSourceResult,
} from '../research/source-provider.js';
import { buildOfficialResearchPortals } from '../research/source-provider.js';
import { containsSecretShape } from '../security/redact-secrets.js';

export type StudyAssistRuntimeInput = Omit<StudyAssistInput, 'material'>;

export interface StudyAssistPreflightData {
  /** Validated and sanitized fields only; raw upload bytes/text are discarded. */
  input: StudyAssistRuntimeInput;
  material: ExtractedStudyMaterial | null;
  materialType: 'text' | 'pdf_base64' | null;
  personalDataMasked: string[];
}

export interface StudyAssistDependencies {
  tutor: StudyTutor | null;
  tutorModel: string | null;
  researchOptions?: CrossrefFetchOptions;
  researchProvider?: (
    request: ResearchSourceRequest,
    options?: CrossrefFetchOptions,
  ) => Promise<ResearchSourceResult>;
  now?: () => Date;
}

function classifyResearchSubject(
  subject: string,
  topic: string,
): ResearchSourceRequest['subject'] {
  const value = `${subject} ${topic}`.toLowerCase();
  if (/\b(?:education|teaching|learning|pedagogy|curriculum|school)\b/u.test(value)) {
    return 'education';
  }
  if (/\b(?:medicine|medical|clinical|disease|patient|pharmac|nursing)\b/u.test(value)) {
    return 'medicine';
  }
  if (/\b(?:health|nutrition|epidemiology|public health|wellness)\b/u.test(value)) {
    return 'health';
  }
  if (/\b(?:biology|biological|genetic|ecology|biochemistry|life science)\b/u.test(value)) {
    return 'life_science';
  }
  return 'general';
}

function toTutorChunks(material: ExtractedStudyMaterial) {
  return material.chunks.map((chunk) => ({
    id: chunk.chunk_id,
    page: chunk.page_number,
    lineStart: chunk.line_start,
    lineEnd: chunk.line_end,
    text: chunk.excerpt,
  }));
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function citedChunkIds(draft: StudyTutorDraft): string[] {
  return uniqueInOrder([
    ...draft.summary_evidence_ids,
    ...draft.sections.flatMap((section) => section.evidence_ids),
    ...draft.key_concepts.flatMap((concept) => concept.evidence_ids),
    ...draft.glossary.flatMap((entry) => entry.evidence_ids),
    ...draft.misconceptions.flatMap((entry) => entry.evidence_ids),
    ...draft.practice_questions.flatMap((question) => question.evidence_ids),
  ]);
}

function citationExcerpt(chunk: StudyMaterialChunk): {
  excerpt: string;
  relativeStart: number;
  relativeEnd: number;
} {
  const firstNonWhitespace = chunk.excerpt.search(/\S/u);
  const relativeStart = firstNonWhitespace < 0 ? 0 : firstNonWhitespace;
  const raw = chunk.excerpt.slice(relativeStart, relativeStart + 420);
  const excerpt = raw.replace(/\s+$/u, '');
  return {
    excerpt: excerpt || chunk.excerpt.slice(0, 1),
    relativeStart,
    relativeEnd: relativeStart + (excerpt || chunk.excerpt.slice(0, 1)).length,
  };
}

function buildMaterialArtifacts(
  material: ExtractedStudyMaterial,
  chunkIds: readonly string[],
) {
  const chunks = new Map(material.chunks.map((chunk) => [chunk.chunk_id, chunk]));
  const evidenceByChunk = new Map<string, string>();
  const citations = chunkIds.map((chunkId, index) => {
    const chunk = chunks.get(chunkId);
    if (!chunk) throw new Error(`unknown material chunk: ${chunkId}`);
    const evidenceId = `evidence-${String(index + 1).padStart(3, '0')}`;
    evidenceByChunk.set(chunkId, evidenceId);
    const selected = citationExcerpt(chunk);
    const start = chunk.source_char_start + selected.relativeStart;
    const end = chunk.source_char_start + selected.relativeEnd;
    return {
      citation_id: `citation-${String(index + 1).padStart(3, '0')}`,
      evidence_id: evidenceId,
      material_id: 'material-001' as const,
      locator:
        material.type === 'text'
          ? ({ type: 'text_range' as const, start_char: start, end_char: end })
          : ({
              type: 'pdf_page_range' as const,
              page: chunk.page_number!,
              start_char: start,
              end_char: end,
            }),
      exact_excerpt: selected.excerpt,
    };
  });
  const mapEvidence = (ids: readonly string[]) =>
    uniqueInOrder(ids.map((id) => evidenceByChunk.get(id)).filter((id): id is string => Boolean(id)));
  return { citations, mapEvidence };
}

function fallbackDraft(material: ExtractedStudyMaterial): StudyTutorDraft {
  const selected = material.chunks.slice(0, 4);
  const first = selected[0]!;
  return {
    summary:
      'The grounded AI explanation was unavailable. KeepFlow has returned an exact source map so the material can still be reviewed without inventing an explanation.',
    summary_evidence_ids: [first.chunk_id],
    sections: selected.map((chunk, index) => ({
      heading: `Review segment ${index + 1}`,
      explanation:
        'Use the cited passage to identify its main claim, supporting reason, and any term that still needs clarification. This is a source-map fallback, not an AI-authored explanation.',
      evidence_ids: [chunk.chunk_id],
      is_analogy: false,
    })),
    key_concepts: [],
    glossary: [],
    misconceptions: [],
    practice_questions: [],
    unresolved_questions: [
      'Retry later for a detailed grounded explanation, or ask an instructor about the cited passages.',
    ],
  };
}

function mapResearchStatus(result: ResearchSourceResult | null, fallbackRetrievedAt: string) {
  if (!result) {
    return {
      status: 'not_requested' as const,
      retrieved_at: null,
      statement: 'External research-source discovery was not requested.',
    };
  }
  if (result.status === 'temporarily_unavailable') {
    return {
      status: 'unavailable' as const,
      retrieved_at: null,
      statement:
        'Crossref was temporarily unavailable. No source was invented; use the official search portals or retry.',
    };
  }
  const retrievedAt = result.sources[0]?.verified_at ?? fallbackRetrievedAt;
  return {
    status: 'success' as const,
    retrieved_at: retrievedAt,
    statement:
      result.status === 'ok'
        ? 'Returned metadata was found in the Crossref registry. Registration does not prove quality, peer review, or correctness.'
        : 'Crossref returned no qualifying DOI records. No fallback citation was invented.',
  };
}

export async function buildStudyAssist(
  preflight: StudyAssistPreflightData,
  dependencies: StudyAssistDependencies,
): Promise<{ output: StudyAssistOutput; researchResult: ResearchSourceResult | null }> {
  const { input, material } = preflight;
  const now = dependencies.now ?? (() => new Date());
  const researchProvider = dependencies.researchProvider ?? recommendResearchSources;

  const tutorWasRequested = input.operation !== 'recommend_sources' && material !== null;
  const tutorPromise = tutorWasRequested && dependencies.tutor
    ? dependencies.tutor.explain({
        operation: input.operation as 'explain_material' | 'summarize_material' | 'practice_questions',
        subject: input.subject,
        topic: input.topic,
        learnerLevel: input.learner_level,
        question: input.question ?? null,
        outputLanguage: input.output_language,
        explanationDepth: input.depth,
        chunks: toTutorChunks(material!),
      }).catch(() => null)
    : Promise.resolve(null);

  const researchRequest: ResearchSourceRequest | null = input.research.enabled
    ? {
        query: input.research.query!,
        subject: classifyResearchSubject(input.subject, input.topic),
        max_results: input.research.max_sources,
        published_after_year: input.research.published_after_year,
      }
    : null;
  const researchPromise = researchRequest
    ? researchProvider(researchRequest, dependencies.researchOptions).catch(() => ({
        status: 'temporarily_unavailable' as const,
        sources: [],
        portals: buildOfficialResearchPortals(researchRequest.query, researchRequest.subject),
      }))
    : Promise.resolve(null);

  const [returnedTutorDraft, researchResult] = await Promise.all([tutorPromise, researchPromise]);
  // Revalidate even injected/test tutor implementations. No caller can make a
  // model-authored URL, secret, or nonexistent evidence identifier trusted.
  const parsedTutorDraft = StudyTutorDraftSchema.safeParse(returnedTutorDraft);
  const tutorDraft = parsedTutorDraft.success && material
    ? validateStudyTutorDraft(parsedTutorDraft.data, toTutorChunks(material)).valid
      ? parsedTutorDraft.data
      : null
    : null;
  const effectiveDraft = material ? (tutorDraft ?? fallbackDraft(material)) : null;
  const usedChunkIds = effectiveDraft ? citedChunkIds(effectiveDraft) : [];
  const artifacts = material ? buildMaterialArtifacts(material, usedChunkIds) : null;
  const evidence = (ids: readonly string[]) => artifacts?.mapEvidence(ids) ?? [];

  const tutorStatus = !tutorWasRequested
    ? ('not_requested' as const)
    : !dependencies.tutor
      ? ('skipped' as const)
      : tutorDraft
        ? ('success' as const)
        : ('failed' as const);
  const generatedAt = now().toISOString();
  const researchStatus = mapResearchStatus(researchResult, generatedAt);

  let mode: StudyAssistOutput['mode'];
  if (input.operation === 'recommend_sources') {
    mode = researchResult?.status === 'ok'
      ? 'completed'
      : researchResult?.status === 'temporarily_unavailable'
        ? 'provider_unavailable'
        : 'needs_clarification';
  } else if (!tutorDraft) {
    mode = 'partial';
  } else if (researchResult?.status === 'temporarily_unavailable') {
    mode = 'partial';
  } else {
    mode = 'completed';
  }

  const output: StudyAssistOutput = {
    service: 'KeepFlow Study - Learning and Research Support',
    response_version: '1.0.0',
    operation: input.operation,
    mode,
    subject: input.subject,
    topic: input.topic,
    output_language: input.output_language,
    answer_summary:
      effectiveDraft?.summary ??
      (researchResult?.status === 'ok'
        ? 'Crossref registry records matching the declared research query are listed below for further evaluation.'
        : 'No verified source recommendation is available from Crossref for this request.'),
    answer_summary_evidence_ids: effectiveDraft
      ? evidence(effectiveDraft.summary_evidence_ids)
      : [],
    material_coverage: material
      ? [
          {
            material_id: 'material-001',
            title: material.title,
            material_type: preflight.materialType!,
            extracted_characters: material.coverage.source_characters,
            analyzed_characters: material.coverage.covered_characters,
            page_count: material.coverage.page_count,
            truncated: false,
            statement:
              'All normalized, sanitized extractable text within the stated limits was analyzed in memory. Citation offsets refer to that in-memory text representation. No upload was stored by KeepFlow.',
          },
        ]
      : [],
    grounded_sections: effectiveDraft
      ? effectiveDraft.sections.map((section, index) => ({
          section_id: `section-${String(index + 1).padStart(3, '0')}`,
          heading: section.heading,
          explanation: section.explanation,
          evidence_ids: evidence(section.evidence_ids),
          is_analogy: section.is_analogy,
        }))
      : [],
    material_citations: artifacts?.citations ?? [],
    key_concepts: effectiveDraft
      ? effectiveDraft.key_concepts.map((concept) => ({
          concept: concept.term,
          explanation: concept.explanation,
          evidence_ids: evidence(concept.evidence_ids),
        }))
      : [],
    glossary: effectiveDraft
      ? effectiveDraft.glossary.map((entry) => ({
          term: entry.term,
          definition: entry.meaning,
          evidence_ids: evidence(entry.evidence_ids),
        }))
      : [],
    misconceptions: effectiveDraft
      ? effectiveDraft.misconceptions.map((entry) => ({
          misconception: entry.misconception,
          correction: entry.correction,
          evidence_ids: evidence(entry.evidence_ids),
        }))
      : [],
    practice_questions: effectiveDraft
      ? effectiveDraft.practice_questions.map((question, index) => ({
          question_id: `practice-${String(index + 1).padStart(3, '0')}`,
          prompt: question.question,
          answer_guidance: question.self_check,
          evidence_ids: evidence(question.evidence_ids),
          novel_not_from_assessment: true as const,
        }))
      : [],
    research_sources: researchResult?.sources ?? [],
    research_portals: researchResult?.portals ?? [],
    source_evaluation_checklist: input.research.enabled
      ? [
          'Open the full work and confirm that its question, population, context, and methods actually match your research need.',
          'Check the venue and your course requirements; a Crossref registry record does not prove peer review or publication quality.',
          'Inspect methods, sample size, limitations, conflicts of interest, and whether later work supports or challenges the findings.',
          'Check current correction and retraction information at the time you cite the work.',
          'Use your institution library or instructor guidance when access, citation style, or source-type rules apply.',
        ]
      : [],
    providers: {
      tutor: {
        provider: 'Anthropic',
        model: dependencies.tutorModel,
        status: tutorStatus,
        statement:
          tutorStatus === 'success'
            ? 'The explanation was generated from bounded, sanitized material chunks and validated evidence identifiers.'
            : tutorWasRequested
              ? 'The grounded tutor was unavailable; an explicit source-map fallback was returned.'
              : 'The tutor model was not needed for this research-only operation.',
      },
      research: {
        provider: 'crossref',
        ...researchStatus,
      },
    },
    integrity_controls: {
      status: 'compliant',
      requested_action: input.academic_integrity.requested_action,
      statement:
        'KeepFlow explained or organized learning material without producing an assessed submission or impersonating the learner.',
      disallowed_help: [
        'Producing a submission for the learner',
        'Taking a live or proctored assessment',
        'Impersonating a learner',
        'Inventing citations or claiming grades',
      ],
      safe_alternative:
        'Use the grounded explanation, practice questions, and verified metadata candidates to learn and prepare your own work.',
    },
    clarifying_questions: effectiveDraft?.unresolved_questions ?? [],
    assumptions: [
      'Uploaded material is treated as untrusted source data, never as system instructions.',
      ...(preflight.personalDataMasked.length
        ? [`Direct identifiers were masked before external processing: ${preflight.personalDataMasked.join(', ')}.`]
        : []),
    ],
    limitations: [
      'AI explanations can be wrong; compare them with the cited material and course requirements.',
      'Crossref registration verifies deposited bibliographic metadata, not truth, quality, peer review, or absence of every correction.',
      'Scanned PDFs, OCR, DOCX, images, and files above the published limits are not supported in this version.',
      'KeepFlow does not reliably identify personal names; remove unnecessary personal information before submitting material.',
    ],
    privacy: {
      stateless: true,
      material_stored_by_keepflow: false,
      conversation_stored_by_keepflow: false,
      external_processing_acknowledged: true,
      cache_control: 'no-store',
      statement:
        'KeepFlow processes material in memory and does not retain it. Sanitized excerpts may be sent to the configured AI provider under that provider\'s data-handling terms, and research queries to Crossref.',
    },
    meta: {
      asp: 'KeepFlow',
      schema_version: '1.0.0',
      generated_at: generatedAt,
      stores_academic_data: false,
      external_ai_contacted: tutorStatus === 'success' || tutorStatus === 'failed',
      external_sources_used: Boolean(researchResult?.sources.length),
    },
  };

  return { output: StudyAssistOutputSchema.parse(output), researchResult };
}

export function validateStudyAssistOutput(
  output: StudyAssistOutput,
  preflight: StudyAssistPreflightData,
  researchResult: ResearchSourceResult | null,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const parsed = StudyAssistOutputSchema.safeParse(output);
  if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => issue.message));
  if (containsSecretShape(JSON.stringify(output))) errors.push('secret-shaped output detected');

  const chunkById = new Map(
    preflight.material?.chunks.map((chunk) => [chunk.chunk_id, chunk]) ?? [],
  );
  for (const citation of output.material_citations) {
    const matchingChunk = [...chunkById.values()].find((chunk) => {
      const pageMatches =
        citation.locator.type === 'text_range'
          ? chunk.page_number === null
          : chunk.page_number === citation.locator.page;
      if (!pageMatches) return false;
      const relativeStart = citation.locator.start_char - chunk.source_char_start;
      const relativeEnd = citation.locator.end_char - chunk.source_char_start;
      return (
        relativeStart >= 0 &&
        relativeEnd <= chunk.excerpt.length &&
        chunk.excerpt.slice(relativeStart, relativeEnd) === citation.exact_excerpt
      );
    });
    if (!matchingChunk) errors.push(`citation does not resolve exactly: ${citation.citation_id}`);
  }

  const providerSources = new Map(
    (researchResult?.sources ?? []).map((source) => [source.doi.toLowerCase(), source]),
  );
  for (const source of output.research_sources) {
    const provider = providerSources.get(source.doi.toLowerCase());
    if (!provider || JSON.stringify(provider) !== JSON.stringify(source)) {
      errors.push(`research source was not copied exactly from provider metadata: ${source.doi}`);
    }
  }
  if (output.research_sources.length !== (researchResult?.sources.length ?? 0)) {
    errors.push('research source count differs from provider result');
  }

  const providerPortals = researchResult?.portals ?? [];
  if (
    output.research_portals.length !== providerPortals.length ||
    output.research_portals.some(
      (portal, index) => JSON.stringify(portal) !== JSON.stringify(providerPortals[index]),
    )
  ) {
    errors.push('research portals differ from provider result');
  }

  return { valid: errors.length === 0, errors };
}

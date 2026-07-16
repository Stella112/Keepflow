import { z } from 'zod';

export const STUDY_ASSIST_MAX_PDF_BYTES = 1_048_576;
export const STUDY_ASSIST_MAX_PDF_BASE64_CHARS =
  Math.ceil(STUDY_ASSIST_MAX_PDF_BYTES / 3) * 4;

const ShortText = z.string().trim().min(1).max(160);
const TopicText = z.string().trim().min(2).max(240);
const QuestionText = z.string().trim().min(3).max(1_200);
const ResearchQuery = z.string().trim().min(3).max(300);
const CURRENT_YEAR = new Date().getUTCFullYear();

export const StudyAssistOperationSchema = z.enum([
  'explain_material',
  'summarize_material',
  'practice_questions',
  'recommend_sources',
]);

export const StudyAssistLearnerLevelSchema = z.enum([
  'primary',
  'secondary',
  'vocational',
  'undergraduate',
  'postgraduate',
  'professional',
  'other',
]);

export const StudyAssistDepthSchema = z.enum([
  'concise',
  'standard',
  'detailed',
]);

const TextMaterialSchema = z
  .object({
    type: z.literal('text'),
    title: ShortText,
    // Preserve the original characters so later citation offsets can be exact.
    content: z
      .string()
      .min(80)
      .max(24_000)
      .refine((value) => value.trim().length >= 80, {
        message: 'text material must contain at least 80 non-whitespace characters',
      }),
  })
  .strict();

const CANONICAL_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodedBase64Bytes(value: string): number | null {
  if (
    value.length < 4 ||
    value.length > STUDY_ASSIST_MAX_PDF_BASE64_CHARS ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64_RE.test(value)
  ) {
    return null;
  }

  // The regular expression checks the alphabet and padding placement. The
  // round trip also rejects encodings with non-zero discarded padding bits,
  // such as "Zh==", which decode but are not canonical base64.
  if (Buffer.from(value, 'base64').toString('base64') !== value) return null;

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

const PdfBase64MaterialSchema = z
  .object({
    type: z.literal('pdf_base64'),
    title: ShortText,
    data: z
      .string()
      .min(4)
      .max(STUDY_ASSIST_MAX_PDF_BASE64_CHARS)
      .superRefine((value, ctx) => {
        const decodedBytes = decodedBase64Bytes(value);
        if (decodedBytes === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'data must be canonical padded base64 without whitespace or a data-URI prefix',
          });
          return;
        }
        if (decodedBytes > STUDY_ASSIST_MAX_PDF_BYTES) {
          ctx.addIssue({
            code: z.ZodIssueCode.too_big,
            type: 'string',
            inclusive: true,
            maximum: STUDY_ASSIST_MAX_PDF_BYTES,
            message: 'decoded PDF must not exceed 1 MiB',
          });
        }
      }),
  })
  .strict();

export const StudyAssistMaterialSchema = z.discriminatedUnion('type', [
  TextMaterialSchema,
  PdfBase64MaterialSchema,
]);

const ResearchOptionsSchema = z
  .object({
    enabled: z.boolean().default(false),
    query: ResearchQuery.optional(),
    published_after_year: z.number().int().min(1500).max(CURRENT_YEAR).optional(),
    max_sources: z.number().int().min(1).max(6).default(4),
  })
  .strict()
  .default({});

const AcademicIntegritySchema = z
  .object({
    requested_action: z.enum([
      'learn_concepts',
      'summarize_material',
      'generate_practice',
      'draft_with_citation_guidance',
      'produce_submission',
      'take_live_assessment',
      'impersonate_learner',
    ]),
  })
  .strict();

export const StudyAssistInputSchema = z
  .object({
    request_version: z.literal('1.0.0').default('1.0.0'),
    operation: StudyAssistOperationSchema,
    subject: ShortText,
    topic: TopicText,
    learner_level: StudyAssistLearnerLevelSchema,
    question: QuestionText.optional(),
    output_language: z.string().trim().min(2).max(40),
    depth: StudyAssistDepthSchema,
    material: StudyAssistMaterialSchema.optional(),
    research: ResearchOptionsSchema,
    academic_integrity: AcademicIntegritySchema,
    // This endpoint sends the supplied material or research query to external
    // providers. Consent is mandatory rather than inferred from use.
    external_processing_acknowledged: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operation !== 'recommend_sources' && !value.material) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['material'],
        message: 'material is required for explanation, summary, and practice-question operations',
      });
    }

    if (
      (value.operation === 'explain_material' || value.operation === 'practice_questions') &&
      !value.question
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['question'],
        message: 'question is required for explanation and practice-question operations',
      });
    }

    if (value.operation === 'recommend_sources' && !value.research.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['research', 'enabled'],
        message: 'research must be enabled when recommending sources',
      });
    }

    if (value.research.enabled && !value.research.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['research', 'query'],
        message: 'an explicit research query is required when research is enabled',
      });
    }

    if (
      !value.research.enabled &&
      (value.research.query !== undefined || value.research.published_after_year !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['research'],
        message: 'research query and publication filters require research.enabled=true',
      });
    }
  });

export type StudyAssistInput = z.infer<typeof StudyAssistInputSchema>;
export type StudyAssistMaterial = z.infer<typeof StudyAssistMaterialSchema>;
export type StudyAssistOperation = z.infer<typeof StudyAssistOperationSchema>;

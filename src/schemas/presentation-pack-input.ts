import { z } from 'zod';

const UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SafeText = (minimum: number, maximum: number) => z
  .string()
  .trim()
  .min(minimum)
  .max(maximum)
  .refine(
    (value) => !UNSAFE_CONTROL_RE.test(value),
    'text contains an unsupported control character',
  );

const EvidenceId = z.string().trim().regex(/^E\d{3}$/);
const HexColor = z.string().trim().regex(/^[0-9A-Fa-f]{6}$/).transform((value) => value.toUpperCase());

export const PresentationSourceItemSchema = z
  .object({
    id: EvidenceId,
    label: SafeText(1, 100),
    content: SafeText(20, 2_000),
  })
  .strict();

const BrandingSchema = z
  .object({
    brand_name: SafeText(1, 80).optional(),
    primary_color: HexColor.default('10182C'),
    accent_color: HexColor.default('19B8B0'),
    footer_text: SafeText(1, 100).optional(),
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

export const PresentationPackInputSchema = z
  .object({
    domain: z.enum(['work', 'study']),
    title: SafeText(3, 120),
    purpose: SafeText(10, 400),
    audience: SafeText(2, 120),
    output_language: SafeText(2, 40).default('English'),
    tone: z
      .enum(['executive', 'clear', 'academic', 'persuasive', 'instructional'])
      .default('clear'),
    requested_slide_count: z.number().int().min(3).max(10).default(6),
    source_items: z.array(PresentationSourceItemSchema).min(1).max(20),
    branding: BrandingSchema,
    academic_integrity: AcademicIntegritySchema.optional(),
    external_processing_acknowledged: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.source_items.forEach((item, index) => {
      if (ids.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source_items', index, 'id'],
          message: 'source item ids must be unique',
        });
      }
      ids.add(item.id);
    });

    if (value.domain === 'study' && !value.academic_integrity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['academic_integrity'],
        message: 'academic_integrity is required for study presentations',
      });
    }
    if (value.domain === 'work' && value.academic_integrity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['academic_integrity'],
        message: 'academic_integrity is only accepted for study presentations',
      });
    }
  });

export type PresentationPackInput = z.infer<typeof PresentationPackInputSchema>;
export type PresentationSourceItem = z.infer<typeof PresentationSourceItemSchema>;

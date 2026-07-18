import { z } from 'zod';

export const PresentationPackOutputSchema = z
  .object({
    service: z.literal('KeepFlow Presentation Pack - Grounded Slide Creation'),
    domain: z.enum(['work', 'study']),
    generation_mode: z.enum(['grounded_ai', 'deterministic_fallback']),
    title: z.string().min(1).max(120),
    slide_count: z.number().int().min(3).max(10),
    source_evidence_count: z.number().int().min(1).max(20),
    personal_data_masked: z.array(z.enum(['email', 'phone', 'student_id'])).max(3),
    presentation_file: z
      .object({
        filename: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}\.pptx$/),
        mime_type: z.literal(
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ),
        encoding: z.literal('base64'),
        byte_length: z.number().int().min(1).max(6 * 1024 * 1024),
        content_base64: z.string().min(1).max(8 * 1024 * 1024),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    quality: z
      .object({
        schema_validated: z.literal(true),
        archive_validated: z.literal(true),
        evidence_references_validated: z.literal(true),
        speaker_notes_slide_count: z.number().int().min(3).max(10),
      })
      .strict(),
    limitations: z.array(z.string().min(1)).min(2).max(6),
    meta: z
      .object({
        asp: z.literal('KeepFlow'),
        schema_version: z.literal('1.0.0'),
        generated_at: z.string().datetime(),
        stateless: z.literal(true),
        stores_files: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type PresentationPackOutput = z.infer<typeof PresentationPackOutputSchema>;

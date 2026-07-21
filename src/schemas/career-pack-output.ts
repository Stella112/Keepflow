import { z } from 'zod';
import { ReminderPackOutputSchema } from './reminder-pack-output.js';

const ArtifactSchema = z.object({
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content_base64: z.string().min(1),
}).strict();

export const CareerPackOutputSchema = z.object({
  service: z.literal('KeepFlow Work & Career - Career Pack'),
  target_role: z.string().min(1),
  resume: z.object({
    headline: z.string().min(1),
    summary: z.string().min(1),
    skills: z.array(z.string().min(1)).min(1),
    experience: z.array(z.object({
      organization: z.string().min(1),
      role: z.string().min(1),
      period: z.string().min(1),
      achievements: z.array(z.string().min(1)).min(1),
    }).strict()).min(1),
    education: z.array(z.string().min(1)),
    certifications: z.array(z.string().min(1)),
  }).strict(),
  cover_letter: z.string().min(1).nullable(),
  keyword_analysis: z.object({
    matched: z.array(z.string().min(1)),
    not_evidenced: z.array(z.string().min(1)),
    notice: z.string().min(1),
  }).strict(),
  interview_prep: z.array(z.object({
    question: z.string().min(1),
    evidence_to_use: z.string().min(1),
  }).strict()),
  artifacts: z.object({ resume_docx: ArtifactSchema, resume_pdf: ArtifactSchema }).strict(),
  reminders: ReminderPackOutputSchema.optional(),
  questions: z.array(z.string().min(1)),
  limitations: z.array(z.string().min(1)).min(1),
  meta: z.object({
    asp: z.literal('KeepFlow'),
    schema_version: z.literal('1.0.0'),
    generated_at: z.string().datetime(),
    claims_invented: z.literal(false),
    stores_payload: z.literal(false),
  }).strict(),
}).strict();

export type CareerPackOutput = z.infer<typeof CareerPackOutputSchema>;

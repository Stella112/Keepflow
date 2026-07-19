import { z } from 'zod';
import {
  ContinuityAccessStateSchema,
  ContinuityResourceSchema,
  ContinuityStakeholderSchema,
} from './continuity-pack-input.js';

const AlternativeSchema = z
  .object({
    resource: ContinuityResourceSchema,
    route: z.string().min(1).max(500),
  })
  .strict();

export const ContinuityActionSchema = z
  .object({
    id: z.string().regex(/^A\d{2}$/),
    priority: z.number().int().min(1).max(50),
    action: z.string().min(1).max(500),
    why: z.string().min(1).max(500),
    requires: z.array(ContinuityResourceSchema).max(5),
    alternatives: z.array(AlternativeSchema).max(5),
    completion_evidence: z.string().min(1).max(300),
  })
  .strict();

const MessageSchema = z
  .object({
    id: z.string().regex(/^M\d{2}$/),
    recipient: ContinuityStakeholderSchema,
    subject: z.string().min(1).max(140),
    message: z.string().min(1).max(1_200),
    delivery_routes: z.array(z.enum([
      'another_device',
      'borrowed_phone',
      'trusted_person',
      'in_person',
    ])).min(1).max(4),
  })
  .strict();

const DelegationCardSchema = z
  .object({
    id: z.string().regex(/^D\d{2}$/),
    delegate_role: z.string().min(1).max(120),
    task: z.string().min(1).max(500),
    share_only: z.array(z.string().min(1).max(200)).min(1).max(6),
    never_share: z.array(z.string().min(1).max(200)).min(1).max(6),
    completion_proof: z.string().min(1).max(300),
  })
  .strict();

const FileSchema = (extension: string, mimeType: string, maxBytes: number) => z
  .object({
    filename: z.string().regex(new RegExp(`^[a-z0-9][a-z0-9-]{0,79}\\.${extension}$`)),
    mime_type: z.literal(mimeType),
    encoding: z.literal('base64'),
    byte_length: z.number().int().min(1).max(maxBytes),
    content_base64: z.string().min(1).max(Math.ceil(maxBytes * 4 / 3) + 8),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const ContinuityPackOutputSchema = z
  .object({
    service: z.literal('KeepFlow Continuity Pack - Executable Life Continuity'),
    situation_type: z.string().min(1),
    location_context: z.string().min(1).max(220),
    access_snapshot: z.record(ContinuityResourceSchema, ContinuityAccessStateSchema),
    personal_data_masked: z.array(z.enum(['email', 'phone', 'student_id'])).max(3),
    first_safe_move: z.string().min(1).max(500),
    timeline: z
      .object({
        next_15_minutes: z.array(ContinuityActionSchema).min(1).max(8),
        today: z.array(ContinuityActionSchema).min(1).max(10),
        next_seven_days: z.array(ContinuityActionSchema).min(1).max(10),
      })
      .strict(),
    ready_to_send_messages: z.array(MessageSchema).min(1).max(7),
    delegation_cards: z.array(DelegationCardSchema).min(1).max(6),
    questions_that_change_the_plan: z.array(z.string().min(1).max(300)).max(6),
    artifacts: z
      .object({
        calendar: FileSchema('ics', 'text/calendar; charset=utf-8', 500_000),
        printable_brief: FileSchema('pdf', 'application/pdf', 4 * 1024 * 1024),
        editable_brief: FileSchema(
          'docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          4 * 1024 * 1024,
        ),
      })
      .strict(),
    quality: z
      .object({
        schema_validated: z.literal(true),
        access_constraints_validated: z.literal(true),
        artifact_integrity_validated: z.literal(true),
        reminders_included: z.literal(true),
        credentials_rejected_before_payment: z.literal(true),
      })
      .strict(),
    limitations: z.array(z.string().min(1)).min(3).max(7),
    meta: z
      .object({
        asp: z.literal('KeepFlow'),
        schema_version: z.literal('1.0.0'),
        generated_at: z.string().datetime(),
        stateless: z.literal(true),
        stores_files: z.literal(false),
        sends_messages: z.literal(false),
        sends_background_notifications: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type ContinuityAction = z.infer<typeof ContinuityActionSchema>;
export type ContinuityPackOutput = z.infer<typeof ContinuityPackOutputSchema>;

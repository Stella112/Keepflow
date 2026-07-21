import { z } from 'zod';
import { ContextEnrichmentRequestSchema } from './context-routing-input.js';

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

export const ContinuityAccessStateSchema = z.enum(['available', 'unavailable', 'unknown']);
export type ContinuityAccessState = z.infer<typeof ContinuityAccessStateSchema>;

export const ContinuityResourceSchema = z.enum([
  'safe_place',
  'another_device',
  'borrowed_phone',
  'internet',
  'money',
  'identification',
  'trusted_person',
  'transport',
]);
export type ContinuityResource = z.infer<typeof ContinuityResourceSchema>;

const AccessProfileSchema = z
  .object({
    safe_place: ContinuityAccessStateSchema,
    another_device: ContinuityAccessStateSchema,
    borrowed_phone: ContinuityAccessStateSchema,
    internet: ContinuityAccessStateSchema,
    money: ContinuityAccessStateSchema,
    identification: ContinuityAccessStateSchema,
    trusted_person: ContinuityAccessStateSchema,
    transport: ContinuityAccessStateSchema,
  })
  .strict();

const LocationSchema = z
  .object({
    country: SafeText(2, 80),
    city_or_area: SafeText(2, 100).optional(),
    away_from_home: z.boolean(),
  })
  .strict();

const DeadlineSchema = z
  .object({
    id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,47}$/),
    label: SafeText(3, 120),
    due_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const ContinuityStakeholderSchema = z.enum([
  'bank_or_card_provider',
  'mobile_carrier',
  'accommodation_or_transport',
  'employer_or_school',
  'family_or_friend',
  'embassy_or_consulate',
  'police_or_local_authority',
]);

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export const ContinuityPackInputSchema = z
  .object({
    situation_type: z.enum([
      'stolen_phone_or_wallet',
      'lost_documents',
      'travel_disruption',
      'account_access_disruption',
      'home_disruption',
      'work_or_study_disruption',
      'other',
    ]),
    description: SafeText(10, 2_000),
    location: LocationSchema,
    access: AccessProfileSchema,
    stakeholders: z.array(ContinuityStakeholderSchema).max(7).default([]),
    immediate_deadlines: z.array(DeadlineSchema).max(8).default([]),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isSupportedTimeZone, 'timezone must be supported by the server IANA database'),
    output_language: z.literal('English').default('English'),
    include_artifacts: z
      .object({
        calendar_ics: z.literal(true).default(true),
        printable_pdf: z.literal(true).default(true),
        editable_docx: z.literal(true).default(true),
      })
      .strict()
      .default({}),
    real_world_context: ContextEnrichmentRequestSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const deadlineIds = new Set<string>();
    value.immediate_deadlines.forEach((deadline, index) => {
      if (deadlineIds.has(deadline.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['immediate_deadlines', index, 'id'],
          message: 'deadline ids must be unique',
        });
      }
      deadlineIds.add(deadline.id);
      if (new Date(deadline.due_at).getTime() <= Date.now() + 10 * 60_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['immediate_deadlines', index, 'due_at'],
          message: 'deadlines must be at least ten minutes in the future',
        });
      }
    });
  });

export type ContinuityPackInput = z.infer<typeof ContinuityPackInputSchema>;

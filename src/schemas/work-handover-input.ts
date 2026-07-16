import { z } from 'zod';

const Id = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'use letters, numbers, dots, colons, underscores, or hyphens');
const ShortText = z.string().trim().min(1).max(200);
const LongText = z.string().trim().min(1).max(1_000);
const DueAt = z.string().datetime({ offset: true });

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const OptionalOwner = ShortText.optional();
const OptionalStatus = z
  .enum(['not_started', 'in_progress', 'blocked', 'paused', 'done', 'cancelled'])
  .optional();

const ResponsibilitySchema = z
  .object({
    id: Id,
    area: ShortText,
    owner: OptionalOwner,
    backup_owner: OptionalOwner,
    status: OptionalStatus,
    notes: LongText.optional(),
  })
  .strict();

const WorkTaskSchema = z
  .object({
    id: Id,
    title: ShortText,
    description: LongText.optional(),
    owner: OptionalOwner,
    status: OptionalStatus,
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    next_action: LongText.optional(),
    due_at: DueAt.optional(),
    dependency_ids: z.array(Id).max(30).default([]),
    blocker_ids: z.array(Id).max(30).default([]),
    definition_of_done: LongText.optional(),
    completion_evidence: LongText.optional(),
    escalation_trigger: LongText.optional(),
  })
  .strict();

const BlockerSchema = z
  .object({
    id: Id,
    description: LongText,
    owner: OptionalOwner,
    status: z.enum(['open', 'monitoring', 'resolved']).optional(),
    next_action: LongText.optional(),
    escalation_trigger: LongText.optional(),
  })
  .strict();

const DependencySchema = z
  .object({
    id: Id,
    description: LongText,
    owner: OptionalOwner,
    status: z.enum(['pending', 'available', 'blocked', 'complete']).optional(),
    due_at: DueAt.optional(),
    escalation_trigger: LongText.optional(),
  })
  .strict();

const StakeholderSchema = z
  .object({
    id: Id,
    name_or_role: ShortText,
    responsibility: LongText.optional(),
    contact_route: ShortText.optional(),
    update_expectation: LongText.optional(),
  })
  .strict();

const AccessNoteSchema = z
  .object({
    id: Id,
    system: ShortText,
    purpose: LongText.optional(),
    access_path: LongText.optional(),
    access_owner: OptionalOwner,
    request_access_from: ShortText.optional(),
    notes: LongText.optional(),
  })
  .strict();

const RiskSchema = z
  .object({
    id: Id,
    description: LongText,
    likelihood: z.enum(['low', 'medium', 'high']).optional(),
    impact: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    owner: OptionalOwner,
    mitigation: LongText.optional(),
    escalation_trigger: LongText.optional(),
  })
  .strict();

const OpenDecisionSchema = z
  .object({
    id: Id,
    question: LongText,
    owner: OptionalOwner,
    needed_by: DueAt.optional(),
    options: z.array(ShortText).max(12).default([]),
  })
  .strict();

export const WorkHandoverInputSchema = z
  .object({
    handover_title: ShortText,
    objective: LongText,
    as_of: DueAt.optional(),
    timezone: z.string().trim().min(1).max(100).refine(isIanaTimeZone, 'must be a valid IANA time zone').optional(),
    current_state: LongText.optional(),
    responsibilities: z.array(ResponsibilitySchema).max(30).default([]),
    tasks: z.array(WorkTaskSchema).min(1).max(50),
    blockers: z.array(BlockerSchema).max(30).default([]),
    dependencies: z.array(DependencySchema).max(30).default([]),
    stakeholders: z.array(StakeholderSchema).max(30).default([]),
    access_notes: z.array(AccessNoteSchema).max(30).default([]),
    risks: z.array(RiskSchema).max(30).default([]),
    open_decisions: z.array(OpenDecisionSchema).max(30).default([]),
    confidentiality: z.enum(['public', 'internal', 'confidential', 'restricted']).default('internal'),
    regulated_or_safety_critical: z.boolean().default(false),
    approved_sop_reference: ShortText.optional(),
    authorized_supervisor: ShortText.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Express currently accepts at most 64 KiB JSON. Keep the parsed contract
    // below that envelope with room for JSON syntax and transport overhead.
    if (JSON.stringify(value).length > 56_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'handover content must be 56,000 characters or fewer',
      });
    }
    const seen = new Map<string, string>();
    const groups: Array<[string, Array<{ id: string }>]> = [
      ['responsibilities', value.responsibilities],
      ['tasks', value.tasks],
      ['blockers', value.blockers],
      ['dependencies', value.dependencies],
      ['stakeholders', value.stakeholders],
      ['access_notes', value.access_notes],
      ['risks', value.risks],
      ['open_decisions', value.open_decisions],
    ];
    for (const [group, items] of groups) {
      items.forEach((item, index) => {
        const prior = seen.get(item.id);
        if (prior) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [group, index, 'id'],
            message: `id must be globally unique; already used by ${prior}`,
          });
        } else {
          seen.set(item.id, group);
        }
      });
    }
  });

export type WorkHandoverInput = z.infer<typeof WorkHandoverInputSchema>;

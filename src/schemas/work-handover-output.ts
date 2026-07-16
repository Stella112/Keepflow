import { z } from 'zod';

const NullableText = z.string().min(1).nullable();
const NullableDueAt = z.string().datetime({ offset: true }).nullable();

const PrioritizedItemSchema = z
  .object({
    rank: z.number().int().positive(),
    task_id: z.string().min(1),
    title: z.string().min(1),
    description: NullableText,
    caller_priority: z.enum(['critical', 'high', 'medium', 'low']).nullable(),
    priority_source: z.enum([
      'caller_priority',
      'caller_priority_with_attention_signals',
      'derived_attention_signals',
      'input_order',
    ]),
    attention_signals: z.array(z.string().min(1)),
    owner: NullableText,
    ownership_state: z.enum(['assigned', 'unassigned']),
    status: z.enum(['not_started', 'in_progress', 'blocked', 'paused', 'done', 'cancelled']).nullable(),
    status_source: z.enum(['caller_reported', 'missing']),
    completion_verification: z.enum([
      'not_applicable',
      'reported_done_unverified',
      'evidence_provided_unverified',
    ]),
    execution_state: z.enum([
      'executable',
      'waiting_for_dependency',
      'blocked',
      'complete',
      'cancelled',
      'unknown',
    ]),
    next_action: z
      .object({
        source: z.enum(['caller_provided', 'missing']),
        value: NullableText,
      })
      .strict(),
    due_at: NullableDueAt,
    deadline_state: z.enum(['overdue', 'upcoming', 'not_provided', 'not_applicable']),
    dependency_ids: z.array(z.string().min(1)),
    blocker_ids: z.array(z.string().min(1)),
    missing_dependency_ids: z.array(z.string().min(1)),
    missing_blocker_ids: z.array(z.string().min(1)),
    definition_of_done: NullableText,
    completion_evidence: NullableText,
    escalation_trigger: NullableText,
    unknown_fields: z.array(
      z.enum([
        'owner',
        'status',
        'next_action',
        'due_at',
        'definition_of_done',
        'completion_evidence',
        'escalation_trigger',
      ]),
    ),
    authorized_review_required: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.next_action.source === 'missing' && value.next_action.value !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['next_action', 'value'],
        message: 'a missing next action must remain null',
      });
    }
    if (value.next_action.source === 'caller_provided' && value.next_action.value === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['next_action', 'value'],
        message: 'a caller-provided next action must retain its text',
      });
    }
  });

const ResponsibilityOutputSchema = z
  .object({
    id: z.string().min(1),
    area: z.string().min(1),
    owner: NullableText,
    backup_owner: NullableText,
    status: z.enum(['not_started', 'in_progress', 'blocked', 'paused', 'done', 'cancelled']).nullable(),
    notes: NullableText,
  })
  .strict();

const BlockerOutputSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    owner: NullableText,
    status: z.enum(['open', 'monitoring', 'resolved']).nullable(),
    next_action: NullableText,
    escalation_trigger: NullableText,
  })
  .strict();

const DependencyOutputSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    owner: NullableText,
    status: z.enum(['pending', 'available', 'blocked', 'complete']).nullable(),
    due_at: NullableDueAt,
    escalation_trigger: NullableText,
  })
  .strict();

const StakeholderOutputSchema = z
  .object({
    id: z.string().min(1),
    name_or_role: z.string().min(1),
    responsibility: NullableText,
    contact_route: NullableText,
    update_expectation: NullableText,
  })
  .strict();

const AccessOutputSchema = z
  .object({
    id: z.string().min(1),
    system: z.string().min(1),
    purpose: NullableText,
    access_path: NullableText,
    access_owner: NullableText,
    request_access_from: NullableText,
    notes: NullableText,
    secret_values_included: z.literal(false),
  })
  .strict();

const RiskOutputSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    likelihood: z.enum(['low', 'medium', 'high']).nullable(),
    impact: z.enum(['low', 'medium', 'high', 'critical']).nullable(),
    owner: NullableText,
    mitigation: NullableText,
    escalation_trigger: NullableText,
  })
  .strict();

const OpenDecisionOutputSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    owner: NullableText,
    needed_by: NullableDueAt,
    options: z.array(z.string().min(1)),
  })
  .strict();

export const WorkHandoverOutputSchema = z
  .object({
    service: z.literal('KeepFlow Work - Operational Handover'),
    assessment: z.enum(['ready', 'needs_information', 'needs_authorized_review']),
    handover_title: z.string().min(1),
    objective: z.string().min(1),
    as_of: NullableDueAt,
    deadline_reference: z.enum(['caller_provided_as_of', 'generation_time']),
    timezone: NullableText,
    current_state: NullableText,
    rule_set_id: z.literal('keepflow-work/operational-handover'),
    rule_set_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    summary: z
      .object({
        total_tasks: z.number().int().nonnegative(),
        unresolved_tasks: z.number().int().nonnegative(),
        blocked_tasks: z.number().int().nonnegative(),
        unassigned_tasks: z.number().int().nonnegative(),
        overdue_tasks: z.number().int().nonnegative(),
        source_based_overview: z.string().min(1),
      })
      .strict(),
    prioritized_items: z.array(PrioritizedItemSchema).min(1),
    handover_checklist: z.array(
      z
        .object({
          step: z.number().int().positive(),
          task_id: z.string().min(1).nullable(),
          action: z.string().min(1),
          evidence_required: z.string().min(1),
          source: z.literal('keepflow_process_suggestion'),
        })
        .strict(),
    ).min(1).max(8),
    responsibility_map: z.array(ResponsibilityOutputSchema),
    blocker_register: z.array(BlockerOutputSchema),
    dependency_register: z.array(DependencyOutputSchema),
    stakeholder_register: z.array(StakeholderOutputSchema),
    access_register: z.array(AccessOutputSchema),
    risk_register: z.array(RiskOutputSchema),
    open_decisions: z.array(OpenDecisionOutputSchema),
    data_quality: z
      .object({
        missing_dependency_refs: z.array(
          z.object({ task_id: z.string().min(1), dependency_id: z.string().min(1) }).strict(),
        ),
        missing_blocker_refs: z.array(
          z.object({ task_id: z.string().min(1), blocker_id: z.string().min(1) }).strict(),
        ),
        dependency_cycles: z.array(z.array(z.string().min(1)).min(2)),
        contradictions: z.array(z.string().min(1)),
        injection_like_text_detected: z.boolean(),
        domain_review_flags: z.array(
          z.enum([
            'legal',
            'hr',
            'medical',
            'safety_critical',
            'financial_execution',
            'regulated_or_safety_critical',
          ]),
        ),
      })
      .strict(),
    unknowns: z.array(z.string().min(1)),
    questions: z.array(z.string().min(1)).max(8),
    assumptions: z.array(z.string().min(1)),
    limitations: z.array(z.string().min(1)),
    confidentiality_controls: z
      .object({
        level: z.enum(['public', 'internal', 'confidential', 'restricted']),
        handling_notice: z.string().min(1),
        secrets_echoed: z.literal(false),
        redaction_applied: z.boolean(),
        sensitive_categories: z.array(z.string().min(1)),
      })
      .strict(),
    authorized_review_gate: z
      .object({
        required: z.boolean(),
        approved_sop_reference: NullableText,
        authorized_supervisor: NullableText,
        both_references_reported: z.boolean(),
        procedural_details_withheld: z.boolean(),
        notice: z.string().min(1),
      })
      .strict(),
    meta: z
      .object({
        asp: z.literal('KeepFlow'),
        schema_version: z.literal('1.0.0'),
        generated_at: z.string().datetime(),
        stateless: z.literal(true),
        stores_payload: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ranks = value.prioritized_items.map((item) => item.rank);
    const expected = value.prioritized_items.map((_, index) => index + 1);
    if (ranks.some((rank, index) => rank !== expected[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prioritized_items'],
        message: 'priority ranks must be sequential and start at 1',
      });
    }
    const ids = value.prioritized_items.map((item) => item.task_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prioritized_items'],
        message: 'task ids must be unique',
      });
    }
    if (
      value.data_quality.domain_review_flags.length > 0 &&
      value.assessment !== 'needs_authorized_review'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assessment'],
        message: 'domain-review flags require authorized review',
      });
    }
  });

export type WorkHandoverOutput = z.infer<typeof WorkHandoverOutputSchema>;

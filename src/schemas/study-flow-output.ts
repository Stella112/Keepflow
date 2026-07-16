import { z } from 'zod';

const PriorityItemSchema = z
  .object({
    rank: z.number().int().positive(),
    task_id: z.string().min(1),
    subject: z.string().min(1),
    title: z.string().min(1),
    importance: z.enum(['low', 'medium', 'high', 'critical']),
    due_at: z.string().datetime({ offset: true }).nullable(),
    remaining_minutes: z.number().int().positive(),
    dependency_status: z.enum(['ready', 'waiting_for_dependency', 'reported_blocker']),
    rationale: z.string().min(1),
  })
  .strict();

const SessionSchema = z
  .object({
    session_id: z.string().regex(/^study-\d{3}$/),
    order: z.number().int().positive(),
    window_id: z.string().min(1),
    task_id: z.string().min(1),
    subject: z.string().min(1),
    title: z.string().min(1),
    starts_at: z.string().datetime({ offset: true }),
    duration_minutes: z.number().int().min(10).max(120),
    objective: z.string().min(1),
    actions: z.array(z.string().min(1)).min(2).max(5),
    definition_of_done: z.string().min(1),
    evidence_of_done: z.string().min(1),
    source_materials: z.array(z.string().min(1)).max(12),
  })
  .strict();

const ChecklistItemSchema = z
  .object({
    step: z.number().int().positive(),
    action: z.string().min(1),
    evidence: z.string().min(1),
    task_id: z.string().min(1).nullable(),
  })
  .strict();

export const StudyFlowOutputSchema = z
  .object({
    service: z.literal('KeepFlow Study - Academic Execution'),
    mode: z.enum(['execution_plan', 'needs_clarification', 'wellbeing_pause', 'integrity_redirect']),
    feasibility: z.enum(['feasible', 'tight', 'infeasible', 'needs_info']),
    goal_summary: z.string().min(1),
    timezone: z.string().min(1),
    rule_set_id: z.literal('keepflow-study/academic-execution'),
    rule_set_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    deterministic_plan_id: z.string().regex(/^study-[0-9a-f]{8}$/),
    capacity_summary: z
      .object({
        available_minutes: z.number().int().nonnegative(),
        required_minutes: z.number().int().nonnegative(),
        scheduled_minutes: z.number().int().nonnegative(),
        unscheduled_minutes: z.number().int().nonnegative(),
      })
      .strict(),
    priority_queue: z.array(PriorityItemSchema),
    sessions: z.array(SessionSchema),
    today_checklist: z.array(ChecklistItemSchema).min(1).max(10),
    progress_checkpoints: z.array(
      z
        .object({
          after_session_id: z.string().regex(/^study-\d{3}$/),
          verify: z.string().min(1),
          if_complete: z.string().min(1),
          if_incomplete: z.string().min(1),
        })
        .strict(),
    ),
    constraint_trace: z.array(
      z
        .object({
          constraint: z.string().min(1),
          effect: z.string().min(1),
        })
        .strict(),
    ),
    integrity_controls: z
      .object({
        requested_action: z.string().min(1),
        status: z.enum(['compliant', 'redirected']),
        disallowed_help: z.array(z.string().min(1)),
        safe_alternative: z.string().min(1),
        statement: z.string().min(1),
      })
      .strict(),
    wellbeing_controls: z
      .object({
        pressure_level: z.enum(['manageable', 'high', 'overwhelming', 'crisis']),
        urgent_support_required: z.boolean(),
        plan_load_adjustment: z.string().min(1),
        statement: z.string().min(1),
      })
      .strict(),
    unresolved_details: z.array(
      z
        .object({
          field: z.string().min(1),
          why_it_matters: z.string().min(1),
          question: z.string().min(1),
        })
        .strict(),
    ).max(20),
    questions: z.array(z.string().min(1)).max(8),
    assumptions: z.array(z.string().min(1)),
    limitations: z.array(z.string().min(1)),
    meta: z
      .object({
        asp: z.literal('KeepFlow'),
        schema_version: z.literal('1.0.0'),
        generated_at: z.string().datetime(),
        stores_academic_data: z.literal(false),
        uses_external_sources: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const scheduled = value.sessions.reduce((total, session) => total + session.duration_minutes, 0);
    if (scheduled !== value.capacity_summary.scheduled_minutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capacity_summary', 'scheduled_minutes'],
        message: 'scheduled_minutes must equal the sum of session durations',
      });
    }
    if (value.capacity_summary.scheduled_minutes > value.capacity_summary.available_minutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capacity_summary'],
        message: 'scheduled minutes must not exceed available minutes',
      });
    }
    if (value.mode === 'wellbeing_pause') {
      if (value.sessions.length > 0 || !value.wellbeing_controls.urgent_support_required) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mode'],
          message: 'wellbeing-pause responses must pause sessions and require support',
        });
      }
    }
    if (value.mode === 'integrity_redirect') {
      if (value.sessions.length > 0 || value.integrity_controls.status !== 'redirected') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mode'],
          message: 'integrity redirects must not schedule the disallowed request',
        });
      }
    }
  });

export type StudyFlowOutput = z.infer<typeof StudyFlowOutputSchema>;

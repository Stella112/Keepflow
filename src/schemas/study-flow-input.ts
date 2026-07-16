import { z } from 'zod';

const ShortText = z.string().trim().min(1).max(160);
const DetailText = z.string().trim().min(1).max(500);
const OffsetDateTime = z.string().datetime({ offset: true });
const TaskId = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);
const WindowId = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

const StudyTaskSchema = z
  .object({
    id: TaskId,
    subject: ShortText,
    title: ShortText,
    kind: z.enum([
      'reading',
      'problem_set',
      'essay',
      'revision',
      'project',
      'presentation',
      'exam_preparation',
      'administrative',
      'other',
    ]),
    status: z.enum(['not_started', 'in_progress', 'blocked', 'completed']).default('not_started'),
    importance: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    estimated_minutes: z
      .number()
      .int()
      .min(10)
      .max(2_400)
      .optional()
      .describe('Remaining focused-work minutes from planning_started_at, not the task original total'),
    due_at: OffsetDateTime.optional(),
    dependencies: z.array(TaskId).max(12).default([]),
    topics: z.array(ShortText).max(12).default([]),
    materials: z.array(ShortText).max(12).default([]),
    definition_of_done: DetailText.optional(),
    evidence_of_done: DetailText.optional(),
  })
  .strict();

const AvailabilityWindowSchema = z
  .object({
    id: WindowId,
    starts_at: OffsetDateTime,
    minutes: z.number().int().min(15).max(720),
  })
  .strict();

const BlockerSchema = z
  .object({
    task_id: TaskId.optional(),
    type: z.enum([
      'unclear_requirements',
      'missing_resource',
      'dependency',
      'technical',
      'accessibility',
      'motivation',
      'anxiety',
      'fatigue',
      'other',
    ]),
    detail: DetailText,
    safe_next_step: DetailText.optional(),
  })
  .strict();

export const StudyFlowInputSchema = z
  .object({
    request_version: z.literal('1.0.0').default('1.0.0'),
    goal: z.string().trim().min(3).max(300),
    planning_started_at: OffsetDateTime,
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+)$/, 'Use an IANA timezone such as Asia/Shanghai')
      .refine(isSupportedTimeZone, 'timezone must be supported by the server IANA database'),
    goal_deadline: OffsetDateTime.optional(),
    tasks: z.array(StudyTaskSchema).min(1).max(40),
    available_windows: z.array(AvailabilityWindowSchema).min(1).max(30),
    preferences: z
      .object({
        preferred_session_minutes: z.number().int().min(15).max(120).default(45),
        break_minutes: z.number().int().min(5).max(30).default(10),
        energy_pattern: z.enum(['morning', 'afternoon', 'evening', 'variable', 'unknown']).default('unknown'),
        internet_access: z.enum(['reliable', 'limited', 'none']).default('reliable'),
        device_access: z.enum(['phone_only', 'shared_computer', 'personal_computer', 'paper_only']).default('personal_computer'),
        quiet_space: z.enum(['yes', 'sometimes', 'no']).default('sometimes'),
        access_needs: z.array(ShortText).max(10).default([]),
      })
      .strict(),
    blockers: z.array(BlockerSchema).max(20).default([]),
    academic_integrity: z
      .object({
        requested_action: z
          .enum([
            'plan_study',
            'learn_concepts',
            'draft_with_citation_guidance',
            'produce_submission',
            'take_live_assessment',
            'impersonate_learner',
          ])
          .default('plan_study'),
        assessment_context: z
          .enum(['practice', 'homework', 'take_home_assessment', 'live_or_proctored_assessment', 'unknown'])
          .default('unknown'),
        collaboration_policy: z
          .enum(['independent', 'collaboration_allowed', 'open_resources', 'unknown'])
          .default('unknown'),
      })
      .strict()
      .default({}),
    wellbeing: z
      .object({
        pressure_level: z.enum(['manageable', 'high', 'overwhelming', 'crisis']).default('manageable'),
        fatigue_level: z.enum(['normal', 'tired', 'severely_sleep_deprived']).default('normal'),
        immediate_safety_concern: z.boolean().default(false),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    const taskIds = new Set<string>();
    value.tasks.forEach((task, index) => {
      if (taskIds.has(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tasks', index, 'id'],
          message: 'task ids must be unique',
        });
      }
      taskIds.add(task.id);
    });

    value.tasks.forEach((task, index) => {
      task.dependencies.forEach((dependency, dependencyIndex) => {
        if (dependency === task.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tasks', index, 'dependencies', dependencyIndex],
            message: 'a task cannot depend on itself',
          });
        } else if (!taskIds.has(dependency)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tasks', index, 'dependencies', dependencyIndex],
            message: 'dependency must reference a declared task id',
          });
        }
      });
    });

    const dependencies = new Map(value.tasks.map((task) => [task.id, task.dependencies]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const dependency of dependencies.get(id) ?? []) {
        if (hasCycle(dependency)) return true;
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (value.tasks.some((task) => hasCycle(task.id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tasks'],
        message: 'task dependencies must not contain a cycle',
      });
    }

    const windowIds = new Set<string>();
    value.available_windows.forEach((window, index) => {
      if (windowIds.has(window.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['available_windows', index, 'id'],
          message: 'availability window ids must be unique',
        });
      }
      windowIds.add(window.id);
    });

    const windows = value.available_windows
      .map((window, index) => ({
        index,
        start: new Date(window.starts_at).getTime(),
        end: new Date(window.starts_at).getTime() + window.minutes * 60_000,
      }))
      .sort((a, b) => a.start - b.start);
    for (let index = 1; index < windows.length; index += 1) {
      const current = windows[index]!;
      const previous = windows[index - 1]!;
      if (current.start < previous.end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['available_windows', current.index],
          message: 'availability windows must not overlap',
        });
      }
    }

    const blockerTaskIds = new Set(value.tasks.map((task) => task.id));
    value.blockers.forEach((blocker, index) => {
      if (blocker.task_id && !blockerTaskIds.has(blocker.task_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blockers', index, 'task_id'],
          message: 'blocker task_id must reference a declared task',
        });
      }
    });
  });

export type StudyFlowInput = z.infer<typeof StudyFlowInputSchema>;
export type StudyFlowTask = StudyFlowInput['tasks'][number];

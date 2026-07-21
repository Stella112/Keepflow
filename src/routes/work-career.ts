import { Router, type NextFunction, type Request, type Response } from 'express';
import { buildCareerPack } from '../engine/career-pack.js';
import { buildEmbeddedReminderPack } from '../engine/embedded-reminders.js';
import { buildWorkHandover, preflightWorkHandover, validateWorkHandover } from '../engine/work-handover.js';
import { log } from '../observability/logger.js';
import { markPaidRouteBodyPrevalidated } from '../payments/paid-routes.js';
import type { CareerPackInput } from '../schemas/career-pack-input.js';
import { WorkCareerInputSchema } from '../schemas/work-career-input.js';
import type { WorkHandoverInput } from '../schemas/work-handover-input.js';
import { containsSecretShape } from '../security/redact-secrets.js';

const MODE_LOCAL = 'keepflowWorkCareerMode';
const INPUT_LOCAL = 'keepflowWorkCareerInput';

export function workCareerPrepaymentGuard(req: Request, res: Response, next: NextFunction): void {
  if (res.locals[MODE_LOCAL]) {
    next();
    return;
  }
  const parsed = WorkCareerInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
    return;
  }

  let input: WorkHandoverInput | CareerPackInput = parsed.data.request;
  if (parsed.data.mode === 'handover') {
    const handoverInput = parsed.data.request as WorkHandoverInput;
    const preflight = preflightWorkHandover(handoverInput);
    if (preflight.sensitive_categories.length > 0) {
      res.status(400).json({
        error: 'sensitive_data_detected',
        categories: preflight.sensitive_categories,
        message: 'Remove credential values and provide only access locations, owners, or request paths.',
      });
      return;
    }
    if (preflight.blocked_category) {
      res.status(403).json({
        error: 'request_blocked',
        category: preflight.blocked_category,
        message: 'KeepFlow Work cannot facilitate credential sharing, security bypass, unauthorized access, or evidence destruction.',
      });
      return;
    }
    input = handoverInput;
  } else if (containsSecretShape(JSON.stringify(parsed.data.request))) {
    res.status(400).json({
      error: 'sensitive_input_detected',
      message: 'Remove passwords, private keys, payment-card data, OTP codes, or access tokens before using KeepFlow Work & Career.',
    });
    return;
  }

  res.locals[MODE_LOCAL] = parsed.data.mode;
  res.locals[INPUT_LOCAL] = input;
  req.body = {};
  if (!markPaidRouteBodyPrevalidated(res, req.method, req.path, parsed.data)) {
    res.status(500).json({ error: 'paid_route_prevalidation_failed' });
    return;
  }
  next();
}

export const workCareerRouter = Router({ caseSensitive: true, strict: true });

workCareerRouter.post('/v1/work-career', workCareerPrepaymentGuard, async (req, res) => {
  const started = Date.now();
  const mode = res.locals[MODE_LOCAL] as 'handover' | 'career' | undefined;
  if (!mode) {
    res.status(500).json({ error: 'work_career_preflight_missing' });
    return;
  }
  try {
    if (mode === 'career') {
      const input = res.locals[INPUT_LOCAL] as CareerPackInput;
      const output = await buildCareerPack(input);
      const events = [
        input.application_deadline ? { id: 'career-application', title: `Submit ${input.target_role} application`, starts_at: input.application_deadline, description: 'Review the truthful resume and cover letter, then submit through the verified employer channel.', source_service: 'work' as const } : null,
        input.interview_at ? { id: 'career-interview', title: `${input.target_role} interview`, starts_at: input.interview_at, description: 'Review the evidence-based interview preparation prompts.', source_service: 'work' as const } : null,
      ].filter((event): event is NonNullable<typeof event> => Boolean(event));
      const reminders = input.timezone ? buildEmbeddedReminderPack({ calendarName: 'KeepFlow Career', timezone: input.timezone, events }) : undefined;
      log.info('workcareer.ok', { mode, reminders_included: Boolean(reminders), latency_ms: Date.now() - started });
      res.json(reminders ? { ...output, reminders } : output);
      return;
    }

    const input = res.locals[INPUT_LOCAL] as WorkHandoverInput;
    const output = buildWorkHandover(input);
    const validation = validateWorkHandover(output, input);
    if (!validation.valid) {
      res.status(500).json({ error: 'handover_generation_failed' });
      return;
    }
    const taskEvents = output.prioritized_items
      .filter((item) => item.due_at && !['complete', 'cancelled'].includes(item.execution_state))
      .map((item) => ({ id: `work-${item.task_id}`, title: item.title, starts_at: item.due_at!, description: item.next_action.value ?? 'Review this work item and record its current status.', source_service: 'work' as const }));
    const decisionEvents = output.open_decisions.filter((item) => item.needed_by).map((item) => ({ id: `decision-${item.id}`, title: `Decision needed: ${item.question}`, starts_at: item.needed_by!, description: 'Review the supplied options and record the authorized decision.', source_service: 'work' as const }));
    const reminders = input.timezone ? buildEmbeddedReminderPack({ calendarName: 'KeepFlow Work', timezone: input.timezone, events: [...taskEvents, ...decisionEvents] }) : undefined;
    log.info('workcareer.ok', { mode, task_count: output.summary.total_tasks, reminders_included: Boolean(reminders), latency_ms: Date.now() - started });
    res.json(reminders ? { ...output, reminder_pack: reminders } : output);
  } catch (error) {
    log.error('workcareer.error', { message: error instanceof Error ? error.message : 'unknown' });
    res.status(500).json({ error: 'internal_error' });
  }
});

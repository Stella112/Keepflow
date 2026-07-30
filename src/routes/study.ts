import { Router, type NextFunction, type Request, type Response } from 'express';
import type { StudyAssistDependencies } from '../engine/study-assist.js';
import { buildEmbeddedReminderPack } from '../engine/embedded-reminders.js';
import { buildStudyFlow, validateStudyFlow } from '../engine/study-flow.js';
import { normalizeJsonObjectField } from '../http/normalize-json-field.js';
import { log } from '../observability/logger.js';
import { markPaidRouteBodyPrevalidated } from '../payments/paid-routes.js';
import { StudyServiceInputSchema } from '../schemas/study-service-input.js';
import type { StudyFlowInput } from '../schemas/study-flow-input.js';
import { containsSecretShape } from '../security/redact-secrets.js';
import {
  captureStudyAssistReplaySnapshot,
  createStudyAssistHandler,
  restoreStudyAssistReplaySnapshot,
  studyAssistPrepaymentGuard,
  type StudyAssistReplaySnapshot,
} from './study-assist.js';

const MODE_LOCAL = 'keepflowStudyServiceMode';
const PLAN_LOCAL = 'keepflowStudyServicePlanInput';

export type StudyServiceReplaySnapshot =
  | { mode: 'plan'; request: StudyFlowInput }
  | { mode: 'assist'; preflight: StudyAssistReplaySnapshot };

export function captureStudyServiceReplaySnapshot(
  res: Response,
): StudyServiceReplaySnapshot | undefined {
  const mode = res.locals[MODE_LOCAL] as 'plan' | 'assist' | undefined;
  if (mode === 'plan') {
    const request = res.locals[PLAN_LOCAL] as StudyFlowInput | undefined;
    return request ? { mode, request: structuredClone(request) } : undefined;
  }
  if (mode === 'assist') {
    const preflight = captureStudyAssistReplaySnapshot(res);
    return preflight ? { mode, preflight } : undefined;
  }
  return undefined;
}

export function restoreStudyServiceReplaySnapshot(
  req: Request,
  res: Response,
  snapshot: StudyServiceReplaySnapshot,
): boolean {
  req.method = 'POST';
  req.body = {};
  res.locals[MODE_LOCAL] = snapshot.mode;
  if (snapshot.mode === 'assist') {
    return restoreStudyAssistReplaySnapshot(req, res, snapshot.preflight);
  }

  const request = structuredClone(snapshot.request);
  res.locals[PLAN_LOCAL] = request;
  return markPaidRouteBodyPrevalidated(res, 'POST', '/v1/study', {
    mode: 'plan',
    request,
  });
}

export async function studyServicePrepaymentGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (res.locals[MODE_LOCAL]) {
    next();
    return;
  }
  const parsed = StudyServiceInputSchema.safeParse(normalizeJsonObjectField(req.body, 'request'));
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_request',
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  res.locals[MODE_LOCAL] = parsed.data.mode;
  if (parsed.data.mode === 'assist') {
    req.body = parsed.data.request;
    await studyAssistPrepaymentGuard(req, res, next);
    return;
  }

  if (containsSecretShape(JSON.stringify(parsed.data.request))) {
    res.status(400).json({
      error: 'sensitive_input_detected',
      message: 'Remove passwords, private keys, payment-card data, OTP codes, or access tokens before using KeepFlow Study.',
    });
    return;
  }
  res.locals[PLAN_LOCAL] = parsed.data.request as StudyFlowInput;
  req.body = {};
  if (!markPaidRouteBodyPrevalidated(res, req.method, req.path, parsed.data)) {
    res.status(500).json({ error: 'paid_route_prevalidation_failed' });
    return;
  }
  next();
}

export function createStudyRouter(dependencies?: StudyAssistDependencies): Router {
  const router = Router({ caseSensitive: true, strict: true });
  const assistHandler = createStudyAssistHandler(dependencies);
  router.post('/v1/study', studyServicePrepaymentGuard, async (req, res) => {
    if (res.locals[MODE_LOCAL] === 'assist') {
      await assistHandler(req, res);
      return;
    }

    const started = Date.now();
    const input = res.locals[PLAN_LOCAL] as StudyFlowInput | undefined;
    if (!input) {
      res.status(500).json({ error: 'study_preflight_missing' });
      return;
    }
    try {
      const output = buildStudyFlow(input);
      const validation = validateStudyFlow(output, input);
      if (!validation.valid) {
        res.status(500).json({ error: 'plan_generation_failed' });
        return;
      }
      const reminders = buildEmbeddedReminderPack({
        calendarName: 'KeepFlow Study',
        timezone: input.timezone,
        events: output.sessions.map((session) => ({
          id: session.session_id,
          title: `${session.subject}: ${session.title}`,
          starts_at: session.starts_at,
          duration_minutes: session.duration_minutes,
          alert_minutes_before: 30,
          description: session.objective,
          source_service: 'study',
        })),
      });
      log.info('study.ok', {
        mode: output.mode,
        session_count: output.sessions.length,
        reminders_included: Boolean(reminders),
        latency_ms: Date.now() - started,
      });
      res.json(reminders ? { ...output, reminder_pack: reminders } : output);
    } catch (error) {
      log.error('study.error', { message: error instanceof Error ? error.message : 'unknown' });
      res.status(500).json({ error: 'internal_error' });
    }
  });
  return router;
}

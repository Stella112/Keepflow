import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  buildWorkHandover,
  preflightWorkHandover,
  validateWorkHandover,
} from '../engine/work-handover.js';
import { log } from '../observability/logger.js';
import {
  WorkHandoverInputSchema,
  type WorkHandoverInput,
} from '../schemas/work-handover-input.js';

/**
 * KeepFlow Work is deterministic and stateless. Shared OKX x402 payment
 * enforcement is mounted upstream by the application.
 */
// Paid routes must match the canonical x402 path exactly.
export const workHandoverRouter = Router({ caseSensitive: true, strict: true });

/**
 * Mount this guard on the exact route before x402 middleware so a caller is
 * never charged for a request that KeepFlow must reject. The router also uses
 * it directly, which keeps standalone deployments safe.
 */
export function workHandoverPrepaymentGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.locals.workHandoverPreflight && res.locals.workHandoverInput) {
    next();
    return;
  }
  const preflight = preflightWorkHandover(req.body);
  if (preflight.sensitive_categories.length > 0) {
    log.warn('workhandover.sensitive_input', {
      categories: preflight.sensitive_categories,
    });
    res.status(400).json({
      error: 'sensitive_data_detected',
      categories: preflight.sensitive_categories,
      message: 'Remove credential values and provide only access locations, owners, or request paths.',
    });
    return;
  }
  if (preflight.blocked_category) {
    log.warn('workhandover.blocked', { category: preflight.blocked_category });
    res.status(403).json({
      error: 'request_blocked',
      category: preflight.blocked_category,
      message: 'KeepFlow Work cannot facilitate credential sharing, security bypass, unauthorized access, or evidence destruction.',
    });
    return;
  }
  const parsed = WorkHandoverInputSchema.safeParse(preflight.sanitized);
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
  res.locals.workHandoverPreflight = preflight;
  res.locals.workHandoverInput = parsed.data;
  next();
}

workHandoverRouter.post('/v1/work-handover', workHandoverPrepaymentGuard, (req: Request, res: Response) => {
  const started = Date.now();
  const input = res.locals.workHandoverInput as WorkHandoverInput;

  try {
    const output = buildWorkHandover(input);
    const validation = validateWorkHandover(output, input);
    if (!validation.valid) {
      log.error('workhandover.invalid', { errors: validation.errors });
      res.status(500).json({ error: 'handover_generation_failed' });
      return;
    }

    log.info('workhandover.ok', {
      assessment: output.assessment,
      task_count: output.summary.total_tasks,
      review_flags: output.data_quality.domain_review_flags,
      injection_like_text: output.data_quality.injection_like_text_detected,
      latency_ms: Date.now() - started,
    });
    res.json(output);
  } catch (error) {
    log.error('workhandover.error', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

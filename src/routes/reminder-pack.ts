import { Router, type NextFunction, type Request, type Response } from 'express';
import { buildReminderPack, validateReminderPack } from '../engine/reminder-pack.js';
import { log } from '../observability/logger.js';
import { markPaidRouteBodyPrevalidated } from '../payments/paid-routes.js';
import { ReminderPackInputSchema } from '../schemas/reminder-pack-input.js';
import { containsSecretShape } from '../security/redact-secrets.js';

export const reminderPackRouter = Router({ caseSensitive: true, strict: true });

export function reminderPackPrepaymentGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.locals.reminderPackInput) {
    next();
    return;
  }
  const parsed = ReminderPackInputSchema.safeParse(req.body);
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
  if (containsSecretShape(JSON.stringify(parsed.data))) {
    res.status(400).json({
      error: 'sensitive_input_detected',
      message: 'Remove passwords, private keys, payment-card data, OTP codes, or access tokens from reminder content.',
    });
    return;
  }

  res.locals.reminderPackInput = parsed.data;
  if (!markPaidRouteBodyPrevalidated(res, req.method, req.path, parsed.data)) {
    res.status(500).json({ error: 'paid_route_prevalidation_missing' });
    return;
  }
  next();
}

reminderPackRouter.post('/v1/reminder-pack', reminderPackPrepaymentGuard, (req: Request, res: Response) => {
  const started = Date.now();
  const input = res.locals.reminderPackInput as ReturnType<typeof ReminderPackInputSchema.parse>;

  try {
    const output = buildReminderPack(input);
    const validation = validateReminderPack(output, input);
    if (!validation.valid) {
      log.error('reminderpack.invalid', { errors: validation.errors });
      res.status(500).json({ error: 'reminder_generation_failed' });
      return;
    }
    log.info('reminderpack.ok', {
      event_count: output.event_count,
      delivery_mode: output.delivery_mode,
      latency_ms: Date.now() - started,
    });
    res.json(output);
  } catch (error) {
    log.error('reminderpack.error', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

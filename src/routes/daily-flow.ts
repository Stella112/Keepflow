import { Router, type Request, type Response } from 'express';
import { buildDailyFlow, validateDailyFlow } from '../engine/daily-flow.js';
import { log } from '../observability/logger.js';
import { DailyFlowInputSchema } from '../schemas/daily-flow-input.js';

/**
 * Daily Flow is deterministic and stateless. Payment is handled upstream by
 * the shared OKX x402 middleware, exactly like First Move.
 */
export const dailyFlowRouter = Router();

dailyFlowRouter.post('/v1/daily-flow', (req: Request, res: Response) => {
  const started = Date.now();
  const parsed = DailyFlowInputSchema.safeParse(req.body);

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

  try {
    const output = buildDailyFlow(parsed.data);
    const validation = validateDailyFlow(output);
    if (!validation.valid) {
      log.error('dailyflow.invalid', { errors: validation.errors });
      res.status(500).json({ error: 'plan_generation_failed' });
      return;
    }

    log.info('dailyflow.ok', {
      eligibility: output.eligibility,
      food_context_pack: output.food_context_pack,
      professional_review_flags: output.professional_review_flags,
      latency_ms: Date.now() - started,
    });
    res.json(output);
  } catch (error) {
    log.error('dailyflow.error', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

import { Router, type Request, type Response } from 'express';
import { buildDailyFlow, validateDailyFlow } from '../engine/daily-flow.js';
import { log } from '../observability/logger.js';
import { DailyFlowInputSchema } from '../schemas/daily-flow-input.js';
import type { ContextRoutingProvider } from '../context/google-maps-provider.js';
import { createGoogleMapsProvider } from '../context/google-maps-provider.js';
import { contextInputForService } from '../context/service-context.js';
import { buildContextRouting } from '../engine/context-routing.js';
import { config } from '../config.js';

/**
 * Daily Flow is deterministic and stateless. Payment is handled upstream by
 * the shared OKX x402 middleware, exactly like First Move.
 */
// Paid routes must match the canonical x402 path exactly.
export function createDailyFlowRouter(provider: ContextRoutingProvider): Router {
  const router = Router({ caseSensitive: true, strict: true });

router.post('/v1/daily-flow', async (req: Request, res: Response) => {
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
    let output = buildDailyFlow(parsed.data);
    if (parsed.data.real_world_context) {
      try {
        const contextInput = contextInputForService({
          sourceService: 'daily_flow',
          need: `Find nearby food venues that may fit a ${parsed.data.goal.replaceAll('_', ' ')} Daily Flow plan and its declared constraints.`,
          request: {
            ...parsed.data.real_world_context,
            search: {
              ...parsed.data.real_world_context.search,
              budget: parsed.data.constraints.budget,
              allergies: [...new Set([
                ...parsed.data.constraints.allergies,
                ...parsed.data.real_world_context.search.allergies,
              ])],
              urgency: 'routine',
            },
          },
          categories: ['restaurant'],
        });
        output = { ...output, context_routing: await buildContextRouting(contextInput, provider) };
      } catch {
        output = {
          ...output,
          context_routing_notice: 'Live nearby-place enrichment was unavailable; the Daily Flow checklist remains usable and no venue facts were invented.',
        };
      }
    }
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
  return router;
}

export const dailyFlowRouter = createDailyFlowRouter(createGoogleMapsProvider({
  apiKey: config.contextRouting.enabled ? config.contextRouting.apiKey : undefined,
  timeoutMs: config.contextRouting.timeoutMs,
}));

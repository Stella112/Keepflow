import type { RequestHandler } from 'express';
import type { ContextRoutingProvider } from './google-maps-provider.js';
import { ContinuityPackInputSchema } from '../schemas/continuity-pack-input.js';
import { DailyFlowInputSchema } from '../schemas/daily-flow-input.js';
import { FirstMoveInputSchema } from '../schemas/firstmove-input.js';

const schemas = {
  '/v1/daily-flow': DailyFlowInputSchema,
  '/v1/first-move': FirstMoveInputSchema,
  '/v1/continuity-pack': ContinuityPackInputSchema,
} as const;

/** Refuse an enrichment request before x402 when its live provider is absent.
 * Malformed bodies continue to the normal schema guard and receive 400. */
export function createContextEnrichmentAvailabilityGuard(
  provider: ContextRoutingProvider,
): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'POST' || !(req.path in schemas)) {
      next();
      return;
    }
    const schema = schemas[req.path as keyof typeof schemas];
    const parsed = schema.safeParse(req.body);
    if (parsed.success && parsed.data.real_world_context && !provider.configured) {
      res.status(503).json({
        error: 'context_routing_unavailable',
        message: 'Live place and route enrichment is not configured. No payment was requested.',
      });
      return;
    }
    next();
  };
}

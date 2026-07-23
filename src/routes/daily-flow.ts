import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { config } from '../config.js';
import { createGoogleMapsProvider, type ContextRoutingProvider } from '../context/google-maps-provider.js';
import { contextInputForService } from '../context/service-context.js';
import { buildContextRouting } from '../engine/context-routing.js';
import { buildDailyFlow, validateDailyFlow } from '../engine/daily-flow.js';
import { buildEmbeddedReminderPack } from '../engine/embedded-reminders.js';
import { log } from '../observability/logger.js';
import { MARKETPLACE_DEFAULT_INPUT_LOCAL } from '../payments/marketplace-replay.js';
import { DailyFlowInputSchema, type DailyFlowInput } from '../schemas/daily-flow-input.js';
import type { DailyFlowOutput } from '../schemas/daily-flow-output.js';

const DAILY_FLOW_OUTPUT_LOCAL = 'keepflowDailyFlowOutput';

function afterMinutes(anchor: string, minutes: number): string {
  return new Date(Date.parse(anchor) + minutes * 60_000).toISOString();
}

async function buildDailyFlowResponse(
  input: DailyFlowInput,
  provider: ContextRoutingProvider,
  marketplaceDefault: boolean,
): Promise<DailyFlowOutput> {
  let output = buildDailyFlow(input);

  if (marketplaceDefault) {
    output = {
      ...output,
      assumptions: [
        'The marketplace replay supplied no personal inputs, so this is a general starter example using a clearly declared sample adult profile and sample foods.',
        ...output.assumptions,
      ],
    };
  }

  if (input.schedule) {
    const events = Array.from({ length: input.schedule.days }, (_, day) => [
      {
        id: `daily-check-in-${day + 1}`,
        title: 'KeepFlow daily check-in',
        starts_at: afterMinutes(input.schedule!.starts_at, day * 1_440),
        duration_minutes: 10,
        alert_minutes_before: 10,
        description: 'Review today’s meal, hydration, movement, and wellbeing checklist.',
        source_service: 'daily_flow' as const,
      },
      {
        id: `daily-movement-${day + 1}`,
        title: 'KeepFlow movement block',
        starts_at: afterMinutes(
          input.schedule!.starts_at,
          day * 1_440 + input.schedule!.movement_offset_minutes,
        ),
        duration_minutes: input.constraints.minutes_available,
        alert_minutes_before: 30,
        description: 'Use the movement option selected in your Daily Flow plan.',
        source_service: 'daily_flow' as const,
      },
    ]).flat();
    const reminderPack = buildEmbeddedReminderPack({
      calendarName: 'KeepFlow Daily',
      timezone: input.schedule.timezone,
      events,
    });
    if (reminderPack) output = { ...output, reminder_pack: reminderPack };
  }

  if (input.real_world_context) {
    try {
      const contextInput = contextInputForService({
        sourceService: 'daily_flow',
        need: `Find nearby food venues that may fit a ${input.goal.replaceAll('_', ' ')} Daily Flow plan and its declared constraints.`,
        request: {
          ...input.real_world_context,
          search: {
            ...input.real_world_context.search,
            budget: input.constraints.budget,
            allergies: [...new Set([
              ...input.constraints.allergies,
              ...input.real_world_context.search.allergies,
            ])],
            urgency: 'routine',
          },
        },
        categories: ['restaurant'],
      });
      output = {
        ...output,
        context_routing: await buildContextRouting(contextInput, provider),
      };
    } catch {
      output = {
        ...output,
        context_routing_notice: 'Live nearby-place enrichment was unavailable; the core meal and movement plan remains complete and usable, and no venue facts were invented.',
      };
    }
  }

  const validation = validateDailyFlow(output);
  if (!validation.valid) {
    log.error('dailyflow.invalid', { errors: validation.errors });
    throw new Error('plan_generation_failed');
  }
  return output;
}

function invalidRequest(
  res: Response,
  issues: { path: PropertyKey[]; message: string }[],
): void {
  res.status(400).json({
    error: 'invalid_request',
    details: issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

/** Prepare the complete Daily deliverable before x402 settlement.
 * Country selection and live location enrichment are optional. When the live
 * provider is unavailable, the core plan is preserved with a clear notice. */
export function createDailyFlowPrepaymentGuard(
  provider: ContextRoutingProvider,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = DailyFlowInputSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidRequest(res, parsed.error.issues);
      return;
    }

    try {
      req.body = parsed.data;
      res.locals[DAILY_FLOW_OUTPUT_LOCAL] = await buildDailyFlowResponse(
        parsed.data,
        provider,
        res.locals[MARKETPLACE_DEFAULT_INPUT_LOCAL] === true,
      );
      next();
    } catch (error) {
      log.error('dailyflow.prepayment_error', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      res.status(500).json({
        error: error instanceof Error && error.message === 'plan_generation_failed'
          ? 'plan_generation_failed'
          : 'internal_error',
      });
    }
  };
}

/**
 * Daily Flow is deterministic and stateless. In the full app, its response is
 * generated before payment and released here only after payment verification.
 */
export function createDailyFlowRouter(provider: ContextRoutingProvider): Router {
  const router = Router({ caseSensitive: true, strict: true });

  router.post('/v1/daily-flow', async (req: Request, res: Response) => {
    const started = Date.now();
    const parsed = DailyFlowInputSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidRequest(res, parsed.error.issues);
      return;
    }

    try {
      const output = (res.locals[DAILY_FLOW_OUTPUT_LOCAL] as DailyFlowOutput | undefined)
        ?? await buildDailyFlowResponse(
          parsed.data,
          provider,
          res.locals[MARKETPLACE_DEFAULT_INPUT_LOCAL] === true,
        );
      log.info('dailyflow.ok', {
        eligibility: output.eligibility,
        food_context_pack: output.food_context_pack,
        professional_review_flags: output.professional_review_flags,
        location_enrichment: output.context_routing
          ? 'included'
          : output.context_routing_notice
            ? 'unavailable_optional'
            : 'not_requested',
        latency_ms: Date.now() - started,
      });
      res.json(output);
    } catch (error) {
      log.error('dailyflow.error', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      res.status(500).json({
        error: error instanceof Error && error.message === 'plan_generation_failed'
          ? 'plan_generation_failed'
          : 'internal_error',
      });
    }
  });

  return router;
}

export const dailyFlowRouter = createDailyFlowRouter(createGoogleMapsProvider({
  apiKey: config.contextRouting.enabled ? config.contextRouting.apiKey : undefined,
  timeoutMs: config.contextRouting.timeoutMs,
}));

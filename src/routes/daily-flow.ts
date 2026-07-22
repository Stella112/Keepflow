import { Router, type NextFunction, type Request, type Response } from 'express';
import { buildDailyFlow, validateDailyFlow } from '../engine/daily-flow.js';
import { log } from '../observability/logger.js';
import { DailyFlowInputSchema } from '../schemas/daily-flow-input.js';
import type { ContextRoutingProvider } from '../context/google-maps-provider.js';
import { createGoogleMapsProvider } from '../context/google-maps-provider.js';
import { contextInputForService } from '../context/service-context.js';
import { buildContextRouting } from '../engine/context-routing.js';
import { config } from '../config.js';
import { buildEmbeddedReminderPack } from '../engine/embedded-reminders.js';
import { containsSecretShape } from '../security/redact-secrets.js';

const DAILY_FLOW_GET_DEFAULT = {
  goal: 'maintain' as const,
  profile: {
    age: 30,
    height_cm: 170,
    weight_kg: 70,
    activity_level: 'lightly_active' as const,
  },
  constraints: {
    food_context_pack: 'custom' as const,
    diet_pattern: 'omnivore' as const,
    allergies: [],
    intolerances: [],
    avoid: [],
    available_foods: ['rice', 'beans', 'eggs', 'leafy vegetables', 'fruit'],
    budget: 'moderate' as const,
    cooking_access: 'basic' as const,
    movement_access: 'walking_only' as const,
    movement_days_per_week: 3,
    minutes_available: 30,
  },
  health_screen: {},
};

const DAILY_FLOW_GET_DEFAULT_LOCAL = 'keepflowDailyFlowGetDefault';

function parseJsonObject(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * OKX's marketplace validator probes service URLs with GET and may replay that
 * method when no service body was attached to the task. Normalize a supplied
 * JSON body/query before payment, or use a transparent general starter profile
 * so a settled marketplace call always receives the advertised JSON resource.
 */
export function dailyFlowGetPrepaymentGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method !== 'GET' || req.path !== '/v1/daily-flow') {
    next();
    return;
  }

  const queryInput = req.query.input ?? req.query.body;
  const hasObjectBody = req.body && typeof req.body === 'object' && Object.keys(req.body).length;
  const candidate = hasObjectBody
    ? req.body
    : queryInput !== undefined
      ? parseJsonObject(Array.isArray(queryInput) ? queryInput[0] : queryInput)
      : DAILY_FLOW_GET_DEFAULT;
  const parsed = DailyFlowInputSchema.safeParse(candidate);
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
      message: 'Remove passwords, private keys, payment-card data, OTP codes, or access tokens before using this service.',
    });
    return;
  }

  req.body = parsed.data;
  res.locals[DAILY_FLOW_GET_DEFAULT_LOCAL] = queryInput === undefined && candidate === DAILY_FLOW_GET_DEFAULT;
  next();
}

function afterMinutes(anchor: string, minutes: number): string {
  return new Date(Date.parse(anchor) + minutes * 60_000).toISOString();
}

/**
 * Daily Flow is deterministic and stateless. Payment is handled upstream by
 * the shared OKX x402 middleware, exactly like First Move.
 */
// Paid routes must match the canonical x402 path exactly.
export function createDailyFlowRouter(provider: ContextRoutingProvider): Router {
  const router = Router({ caseSensitive: true, strict: true });

const handleDailyFlow = async (req: Request, res: Response) => {
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
    if (res.locals[DAILY_FLOW_GET_DEFAULT_LOCAL] === true) {
      output = {
        ...output,
        assumptions: [
          'The marketplace replay supplied no personal inputs, so this is a general starter example using a clearly declared sample adult profile and sample foods.',
          ...output.assumptions,
        ],
      };
    }
    if (parsed.data.schedule) {
      const events = Array.from({ length: parsed.data.schedule.days }, (_, day) => [
        {
          id: `daily-check-in-${day + 1}`,
          title: 'KeepFlow daily check-in',
          starts_at: afterMinutes(parsed.data.schedule!.starts_at, day * 1_440),
          duration_minutes: 10,
          alert_minutes_before: 10,
          description: 'Review today’s meal, hydration, movement, and wellbeing checklist.',
          source_service: 'daily_flow' as const,
        },
        {
          id: `daily-movement-${day + 1}`,
          title: 'KeepFlow movement block',
          starts_at: afterMinutes(
            parsed.data.schedule!.starts_at,
            day * 1_440 + parsed.data.schedule!.movement_offset_minutes,
          ),
          duration_minutes: parsed.data.constraints.minutes_available,
          alert_minutes_before: 30,
          description: 'Use the movement option selected in your Daily Flow plan.',
          source_service: 'daily_flow' as const,
        },
      ]).flat();
      const reminderPack = buildEmbeddedReminderPack({
        calendarName: 'KeepFlow Daily',
        timezone: parsed.data.schedule.timezone,
        events,
      });
      if (reminderPack) output = { ...output, reminder_pack: reminderPack };
    }
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
};
router.get('/v1/daily-flow', handleDailyFlow);
router.post('/v1/daily-flow', handleDailyFlow);
  return router;
}

export const dailyFlowRouter = createDailyFlowRouter(createGoogleMapsProvider({
  apiKey: config.contextRouting.enabled ? config.contextRouting.apiKey : undefined,
  timeoutMs: config.contextRouting.timeoutMs,
}));

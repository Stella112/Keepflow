import type { NextFunction, Request, Response } from 'express';

export const MARKETPLACE_DEFAULT_INPUT_LOCAL = 'keepflowMarketplaceDefaultInput';

const MARKETPLACE_PATHS = new Set([
  '/v1/continuity-pack',
  '/v1/daily-flow',
  '/v1/study',
  '/v1/work-career',
]);

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function defaultInput(path: string): unknown {
  if (path === '/v1/continuity-pack') {
    return {
      situation_type: 'stolen_phone_or_wallet',
      description: 'Marketplace starter example: a solo traveller has lost access to a phone and wallet and needs safe, access-aware first actions.',
      location: { country: 'Unknown country', away_from_home: true },
      access: {
        safe_place: 'unknown',
        another_device: 'unavailable',
        borrowed_phone: 'unknown',
        internet: 'unknown',
        money: 'unavailable',
        identification: 'unknown',
        trusted_person: 'unknown',
        transport: 'unknown',
      },
      stakeholders: ['bank_or_card_provider', 'mobile_carrier', 'family_or_friend'],
      immediate_deadlines: [],
      timezone: 'UTC',
      output_language: 'English',
      include_artifacts: {},
    };
  }
  if (path === '/v1/daily-flow') {
    return {
      goal: 'maintain',
      profile: { age: 30, height_cm: 170, weight_kg: 70, activity_level: 'lightly_active' },
      constraints: {
        food_context_pack: 'custom',
        diet_pattern: 'omnivore',
        allergies: [],
        intolerances: [],
        avoid: [],
        available_foods: ['rice', 'beans', 'eggs', 'leafy vegetables', 'fruit'],
        budget: 'moderate',
        cooking_access: 'basic',
        movement_access: 'walking_only',
        movement_days_per_week: 3,
        minutes_available: 30,
      },
      health_screen: {},
    };
  }
  if (path === '/v1/study') {
    return {
      mode: 'plan',
      request: {
        goal: 'Marketplace starter example: organize a focused review session.',
        planning_started_at: futureIso(15),
        timezone: 'UTC',
        goal_deadline: futureIso(2_880),
        tasks: [{
          id: 'starter-review',
          subject: 'General study',
          title: 'Review the supplied learning material',
          kind: 'revision',
          importance: 'high',
          estimated_minutes: 60,
          due_at: futureIso(1_440),
          materials: ['Learner-supplied notes'],
          definition_of_done: 'Complete a self-check and list remaining questions.',
          evidence_of_done: 'A completed self-check and question list.',
        }],
        available_windows: [{ id: 'starter-window', starts_at: futureIso(60), minutes: 90 }],
        preferences: {
          preferred_session_minutes: 45,
          break_minutes: 10,
          energy_pattern: 'variable',
          internet_access: 'limited',
          device_access: 'shared_computer',
          quiet_space: 'sometimes',
        },
        academic_integrity: {
          requested_action: 'plan_study',
          assessment_context: 'practice',
          collaboration_policy: 'open_resources',
        },
      },
    };
  }
  if (path === '/v1/work-career') {
    return {
      mode: 'handover',
      request: {
        handover_title: 'Marketplace starter handover',
        objective: 'Demonstrate a safe operational handover when the buyer supplied no project details.',
        timezone: 'UTC',
        tasks: [{
          id: 'starter-status-review',
          title: 'Confirm current work status',
          owner: 'Assigned team owner',
          status: 'not_started',
          priority: 'high',
          next_action: 'Replace this starter item with the actual tasks, owners, dependencies, and deadlines.',
          due_at: futureIso(1_440),
          definition_of_done: 'The real handover facts are confirmed by the responsible owner.',
        }],
      },
    };
  }
  return undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Adapt OKX's paid GET replay to each service's canonical POST pipeline. */
export function marketplacePaidGetReplayAdapter(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    req.method !== 'GET' ||
    !MARKETPLACE_PATHS.has(req.path) ||
    (!req.headers['payment-signature'] && !req.headers['x-payment'])
  ) {
    next();
    return;
  }

  const queryInput = req.query.input ?? req.query.body;
  const hasBody = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0;
  const fallback = defaultInput(req.path);
  req.body = hasBody
    ? req.body
    : queryInput !== undefined
      ? parseJson(Array.isArray(queryInput) ? queryInput[0] : queryInput)
      : fallback;
  res.locals[MARKETPLACE_DEFAULT_INPUT_LOCAL] = !hasBody && queryInput === undefined;
  req.method = 'POST';
  next();
}

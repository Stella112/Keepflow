import type { Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { DailyFlowInputSchema } from '../schemas/daily-flow-input.js';
import { FirstMoveInputSchema } from '../schemas/firstmove-input.js';
import { StudyFlowInputSchema } from '../schemas/study-flow-input.js';
import { WorkHandoverInputSchema } from '../schemas/work-handover-input.js';
import { StudyAssistInputSchema } from '../schemas/study-assist-input.js';
import { ReminderPackInputSchema } from '../schemas/reminder-pack-input.js';
import { PresentationPackInputSchema } from '../schemas/presentation-pack-input.js';
import { ContinuityPackInputSchema } from '../schemas/continuity-pack-input.js';
import { containsSecretShape } from '../security/redact-secrets.js';
import { createHash } from 'node:crypto';

interface PaidRouteBase {
  method: 'POST';
  path: string;
  description: string;
  operationId: string;
  inputSchema: ZodTypeAny;
}

export interface SchemaValidatedPaidRouteSpec extends PaidRouteBase {
  bodyValidation: 'schema';
  /** First Move intentionally accepts exposed credentials so it can produce
   * the deterministic exposure runbook after redacting them. Other services
   * have no legitimate need to receive credentials and reject them for free. */
  allowSecretBearingInput: boolean;
}

export interface PrevalidatedBodyPaidRouteSpec extends PaidRouteBase {
  /** A route-specific guard has already parsed, bounded, extracted, screened,
   * and (where necessary) cleared the original large request body. The generic
   * validator must verify the server-only res.locals marker and must never
   * inspect req.body for this mode. */
  bodyValidation: 'prevalidated_body';
}

export type PaidRouteSpec =
  | SchemaValidatedPaidRouteSpec
  | PrevalidatedBodyPaidRouteSpec;

/** Server-only response-local key used to prove large-body prevalidation ran. */
export const PAID_ROUTE_PREVALIDATION_LOCAL =
  'keepflowPaidRoutePrevalidatedKey' as const;
export const PAID_ROUTE_FINGERPRINT_LOCAL =
  'keepflowPaidRouteRequestFingerprint' as const;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function fingerprintValidatedRequest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function paidRouteKey(method: string, path: string): string {
  return `${method} ${path}`;
}

export const PAID_ROUTE_SPECS: readonly PaidRouteSpec[] = [
  {
    method: 'POST',
    path: '/v1/first-move',
    description: 'KeepFlow - First Move - Ordered Incident Recovery',
    operationId: 'createFirstMovePlan',
    bodyValidation: 'schema',
    inputSchema: FirstMoveInputSchema,
    allowSecretBearingInput: true,
  },
  {
    method: 'POST',
    path: '/v1/daily-flow',
    description: 'KeepFlow - Daily Flow - Constraint-Aware Meal & Movement Checklist',
    operationId: 'createDailyFlowPlan',
    bodyValidation: 'schema',
    inputSchema: DailyFlowInputSchema,
    allowSecretBearingInput: false,
  },
  {
    method: 'POST',
    path: '/v1/study-flow',
    description: 'KeepFlow Study - Academic Execution',
    operationId: 'createStudyFlowPlan',
    bodyValidation: 'schema',
    inputSchema: StudyFlowInputSchema,
    allowSecretBearingInput: false,
  },
  {
    method: 'POST',
    path: '/v1/study-assist',
    description: 'KeepFlow Study - Grounded Learning and Verified Research Support',
    operationId: 'createStudyAssistPack',
    inputSchema: StudyAssistInputSchema,
    bodyValidation: 'prevalidated_body',
  },
  {
    method: 'POST',
    path: '/v1/work-handover',
    description: 'KeepFlow Work - Operational Handover',
    operationId: 'createWorkHandover',
    bodyValidation: 'schema',
    inputSchema: WorkHandoverInputSchema,
    allowSecretBearingInput: false,
  },
  {
    method: 'POST',
    path: '/v1/reminder-pack',
    description: 'KeepFlow - Calendar Reminder Pack',
    operationId: 'createReminderPack',
    inputSchema: ReminderPackInputSchema,
    bodyValidation: 'prevalidated_body',
  },
  {
    method: 'POST',
    path: '/v1/presentation-pack',
    description: 'KeepFlow Work and Study - Grounded Presentation Pack',
    operationId: 'createPresentationPack',
    inputSchema: PresentationPackInputSchema,
    bodyValidation: 'prevalidated_body',
  },
  {
    method: 'POST',
    path: '/v1/continuity-pack',
    description: 'KeepFlow - Access-Aware Executable Continuity Pack',
    operationId: 'createContinuityPack',
    inputSchema: ContinuityPackInputSchema,
    bodyValidation: 'prevalidated_body',
  },
] as const;

export const PAID_ROUTE_KEYS = PAID_ROUTE_SPECS.map(
  (route) => paidRouteKey(route.method, route.path),
);

export function findPaidRoute(method: string, path: string): PaidRouteSpec | undefined {
  return PAID_ROUTE_SPECS.find((route) => route.method === method && route.path === path);
}

/**
 * OKX validates an x402 A2MCP listing with a body-less request before it knows
 * the service's business parameters. That request must reach the payment
 * middleware and receive the standard 402 challenge. Ordinary malformed
 * requests still fail before payment, and a request carrying a payment header
 * is never treated as discovery.
 */
export function isUnpaidX402DiscoveryProbe(
  req: Pick<Request, 'method' | 'path' | 'body' | 'headers'>,
): boolean {
  if (!findPaidRoute(req.method, req.path)) return false;
  if (req.headers['payment-signature'] || req.headers['x-payment']) return false;

  return req.body === undefined;
}

/**
 * Mark an exact prevalidated-body route after its route-specific guard has
 * completed. Returns false for aliases, ordinary schema routes, or unknown
 * paths so callers can fail closed rather than accidentally blessing a body.
 */
export function markPaidRouteBodyPrevalidated(
  res: Response,
  method: string,
  path: string,
  validatedInput?: unknown,
): boolean {
  const route = findPaidRoute(method, path);
  if (!route || route.bodyValidation !== 'prevalidated_body') return false;
  res.locals[PAID_ROUTE_PREVALIDATION_LOCAL] = paidRouteKey(method, path);
  if (validatedInput !== undefined) {
    res.locals[PAID_ROUTE_FINGERPRINT_LOCAL] = fingerprintValidatedRequest(validatedInput);
  }
  return true;
}

function normalizePossibleAlias(path: string): string | null {
  try {
    return decodeURIComponent(path)
      .replace(/\/{2,}/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Express routers are permissive by default. Recognize alternate spellings of
 * a paid path so they can be rejected before x402 instead of falling through
 * to a handler that the payment SDK did not protect.
 */
export function findPaidRouteAlias(method: string, path: string): PaidRouteSpec | undefined {
  if (method !== 'POST') return undefined;
  const normalized = normalizePossibleAlias(path);
  if (!normalized) return undefined;
  return PAID_ROUTE_SPECS.find(
    (route) => normalizePossibleAlias(route.path) === normalized,
  );
}

/** Reject route spellings the handlers might otherwise accept but x402 does not. */
export const rejectNonCanonicalPaidRouteAliases: RequestHandler = (req, res, next) => {
  if (!findPaidRoute(req.method, req.path)) {
    const aliasedRoute = findPaidRouteAlias(req.method, req.path);
    if (aliasedRoute) {
      res.status(404).json({
        error: 'non_canonical_paid_route',
        canonical_path: aliasedRoute.path,
      });
      return;
    }
  }
  next();
};

/**
 * Validate paid request bodies before the x402 middleware. Malformed or
 * credential-bearing requests therefore fail without asking the customer to
 * pay for an unusable response.
 */
export const validatePaidRequestBeforePayment: RequestHandler = (req, res, next) => {
  const route = findPaidRoute(req.method, req.path);
  if (!route) {
    const aliasedRoute = findPaidRouteAlias(req.method, req.path);
    if (aliasedRoute) {
      res.status(404).json({
        error: 'non_canonical_paid_route',
        canonical_path: aliasedRoute.path,
      });
      return;
    }
    next();
    return;
  }

  if (route.bodyValidation === 'prevalidated_body') {
    const expectedMarker = paidRouteKey(route.method, route.path);
    if (res.locals[PAID_ROUTE_PREVALIDATION_LOCAL] !== expectedMarker) {
      res.status(500).json({ error: 'paid_route_prevalidation_missing' });
      return;
    }
    next();
    return;
  }

  const parsed = route.inputSchema.safeParse(req.body);
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

  if (!route.allowSecretBearingInput && containsSecretShape(JSON.stringify(parsed.data))) {
    res.status(400).json({
      error: 'sensitive_input_detected',
      message: 'Remove passwords, private keys, payment-card data, OTP codes, or access tokens before using this service.',
    });
    return;
  }

  // Preserve schema defaults so the paid replay and route handler see exactly
  // the same validated request shape.
  req.body = parsed.data;
  res.locals[PAID_ROUTE_FINGERPRINT_LOCAL] = fingerprintValidatedRequest(parsed.data);
  next();
};

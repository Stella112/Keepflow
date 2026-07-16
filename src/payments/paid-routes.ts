import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { DailyFlowInputSchema } from '../schemas/daily-flow-input.js';
import { FirstMoveInputSchema } from '../schemas/firstmove-input.js';
import { StudyFlowInputSchema } from '../schemas/study-flow-input.js';
import { WorkHandoverInputSchema } from '../schemas/work-handover-input.js';
import { containsSecretShape } from '../security/redact-secrets.js';

export interface PaidRouteSpec {
  method: 'POST';
  path: string;
  description: string;
  inputSchema: ZodTypeAny;
  /** First Move intentionally accepts exposed credentials so it can produce
   * the deterministic exposure runbook after redacting them. Other services
   * have no legitimate need to receive credentials and reject them for free. */
  allowSecretBearingInput: boolean;
}

export const PAID_ROUTE_SPECS: readonly PaidRouteSpec[] = [
  {
    method: 'POST',
    path: '/v1/first-move',
    description: 'KeepFlow - First Move - Ordered Incident Recovery',
    inputSchema: FirstMoveInputSchema,
    allowSecretBearingInput: true,
  },
  {
    method: 'POST',
    path: '/v1/daily-flow',
    description: 'KeepFlow - Daily Flow - Constraint-Aware Meal & Movement Checklist',
    inputSchema: DailyFlowInputSchema,
    allowSecretBearingInput: false,
  },
  {
    method: 'POST',
    path: '/v1/study-flow',
    description: 'KeepFlow Study - Academic Execution',
    inputSchema: StudyFlowInputSchema,
    allowSecretBearingInput: false,
  },
  {
    method: 'POST',
    path: '/v1/work-handover',
    description: 'KeepFlow Work - Operational Handover',
    inputSchema: WorkHandoverInputSchema,
    allowSecretBearingInput: false,
  },
] as const;

export const PAID_ROUTE_KEYS = PAID_ROUTE_SPECS.map(
  (route) => `${route.method} ${route.path}`,
);

export function findPaidRoute(method: string, path: string): PaidRouteSpec | undefined {
  return PAID_ROUTE_SPECS.find((route) => route.method === method && route.path === path);
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
  next();
};

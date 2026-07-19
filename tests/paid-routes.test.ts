import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  PAID_ROUTE_KEYS,
  PAID_ROUTE_PREVALIDATION_LOCAL,
  PAID_ROUTE_SPECS,
  findPaidRoute,
  findPaidRouteAlias,
  markPaidRouteBodyPrevalidated,
  rejectNonCanonicalPaidRouteAliases,
  validatePaidRequestBeforePayment,
} from '../src/payments/paid-routes.js';

interface ResponseState {
  locals: Record<string, unknown>;
  statusCode?: number;
  body?: unknown;
  status(code: number): ResponseState;
  json(body: unknown): ResponseState;
}

function responseState(): ResponseState {
  return {
    locals: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function request(method: string, path: string, body?: unknown): Request {
  return { method, path, body } as Request;
}

function run(
  middleware: typeof validatePaidRequestBeforePayment,
  req: Request,
  state: ResponseState,
) {
  const next = vi.fn() as unknown as NextFunction;
  middleware(req, state as unknown as Response, next);
  return next;
}

describe('paid-route registry', () => {
  it('contains all eight exact paid capabilities at the shared five-cent default', () => {
    expect(PAID_ROUTE_KEYS).toEqual([
      'POST /v1/first-move',
      'POST /v1/daily-flow',
      'POST /v1/study-flow',
      'POST /v1/study-assist',
      'POST /v1/work-handover',
      'POST /v1/reminder-pack',
      'POST /v1/presentation-pack',
      'POST /v1/continuity-pack',
    ]);
    expect(PAID_ROUTE_SPECS).toHaveLength(8);
    expect(loadConfig().payments.priceUsd).toBe('$0.05');

    expect(findPaidRoute('POST', '/v1/study-assist')).toMatchObject({
      description: 'KeepFlow Study - Grounded Learning and Verified Research Support',
      bodyValidation: 'prevalidated_body',
    });
  });

  it('recognizes alternate spellings without treating them as exact paid routes', () => {
    for (const route of PAID_ROUTE_SPECS) {
      const aliases = [
        `${route.path}/`,
        route.path.toUpperCase(),
        `${route.path}//`,
      ];
      for (const alias of aliases) {
        expect(findPaidRoute('POST', alias), alias).toBeUndefined();
        expect(findPaidRouteAlias('POST', alias)?.path, alias).toBe(route.path);
      }
    }

    expect(findPaidRouteAlias('POST', '/v1/%73tudy-assist')?.path).toBe('/v1/study-assist');
    expect(findPaidRouteAlias('GET', '/v1/study-assist/')).toBeUndefined();
  });

  it('rejects a Study Assist alias with the canonical path before payment', () => {
    const state = responseState();
    const next = run(
      rejectNonCanonicalPaidRouteAliases,
      request('POST', '/V1/STUDY-ASSIST/'),
      state,
    );
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(404);
    expect(state.body).toEqual({
      error: 'non_canonical_paid_route',
      canonical_path: '/v1/study-assist',
    });
  });
});

describe('prevalidated paid bodies', () => {
  it('fails closed when the Study Assist prevalidation marker is missing', () => {
    const state = responseState();
    const next = run(
      validatePaidRequestBeforePayment,
      request('POST', '/v1/study-assist', { should_not_be_read: true }),
      state,
    );
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: 'paid_route_prevalidation_missing' });

    const reminderState = responseState();
    const reminderNext = run(
      validatePaidRequestBeforePayment,
      request('POST', '/v1/reminder-pack', { should_not_be_read: true }),
      reminderState,
    );
    expect(reminderNext).not.toHaveBeenCalled();
    expect(reminderState.statusCode).toBe(500);
    expect(reminderState.body).toEqual({ error: 'paid_route_prevalidation_missing' });

    const presentationState = responseState();
    const presentationNext = run(
      validatePaidRequestBeforePayment,
      request('POST', '/v1/presentation-pack', { should_not_be_read: true }),
      presentationState,
    );
    expect(presentationNext).not.toHaveBeenCalled();
    expect(presentationState.statusCode).toBe(500);
    expect(presentationState.body).toEqual({ error: 'paid_route_prevalidation_missing' });

    const continuityState = responseState();
    const continuityNext = run(
      validatePaidRequestBeforePayment,
      request('POST', '/v1/continuity-pack', { should_not_be_read: true }),
      continuityState,
    );
    expect(continuityNext).not.toHaveBeenCalled();
    expect(continuityState.statusCode).toBe(500);
    expect(continuityState.body).toEqual({ error: 'paid_route_prevalidation_missing' });
  });

  it('accepts only a server marker for that exact canonical route', () => {
    const state = responseState();
    expect(markPaidRouteBodyPrevalidated(
      state as unknown as Response,
      'POST',
      '/v1/study-assist',
    )).toBe(true);
    expect(state.locals[PAID_ROUTE_PREVALIDATION_LOCAL]).toBe('POST /v1/study-assist');

    const req = request('POST', '/v1/study-assist');
    Object.defineProperty(req, 'body', {
      configurable: true,
      get() {
        throw new Error('prevalidated routes must not re-read req.body');
      },
    });
    const next = run(validatePaidRequestBeforePayment, req, state);
    expect(next).toHaveBeenCalledOnce();
    expect(state.statusCode).toBeUndefined();
  });

  it('rejects a marker copied from another path and refuses to mark aliases or schema routes', () => {
    const wrong = responseState();
    wrong.locals[PAID_ROUTE_PREVALIDATION_LOCAL] = 'POST /v1/other';
    const next = run(
      validatePaidRequestBeforePayment,
      request('POST', '/v1/study-assist'),
      wrong,
    );
    expect(next).not.toHaveBeenCalled();
    expect(wrong.statusCode).toBe(500);

    const state = responseState();
    expect(markPaidRouteBodyPrevalidated(
      state as unknown as Response,
      'POST',
      '/v1/study-assist/',
    )).toBe(false);
    expect(markPaidRouteBodyPrevalidated(
      state as unknown as Response,
      'POST',
      '/v1/study-flow',
    )).toBe(false);
    expect(state.locals[PAID_ROUTE_PREVALIDATION_LOCAL]).toBeUndefined();
  });

  it('preserves ordinary schema validation for the other paid routes', () => {
    const validState = responseState();
    const validRequest = request('POST', '/v1/first-move', {
      description: 'My phone was stolen.',
    });
    const validNext = run(validatePaidRequestBeforePayment, validRequest, validState);
    expect(validNext).toHaveBeenCalledOnce();
    expect(validState.statusCode).toBeUndefined();

    const invalidState = responseState();
    const invalidNext = run(
      validatePaidRequestBeforePayment,
      request('POST', '/v1/study-flow', {}),
      invalidState,
    );
    expect(invalidNext).not.toHaveBeenCalled();
    expect(invalidState.statusCode).toBe(400);
    expect(invalidState.body).toMatchObject({ error: 'invalid_request' });
  });
});

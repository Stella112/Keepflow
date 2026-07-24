import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { paymentMiddlewareFromHTTPServer } from '@okxweb3/x402-express';
import { marketplacePaidReplayAdapter } from '../src/payments/marketplace-replay.js';
import {
  createDailyFlowPrepaymentGuard,
  createDailyFlowRouter,
} from '../src/routes/daily-flow.js';
import type { ContextRoutingProvider } from '../src/context/google-maps-provider.js';

describe('OKX x402 paid replay compatibility', () => {
  it('recognizes legacy X-PAYMENT and releases a GET JSON result after settlement', async () => {
    const processHTTPRequest = vi.fn(async (context: { paymentHeader?: string }) => {
      if (context.paymentHeader !== 'signed-proof') {
        return {
          type: 'payment-error',
          response: { status: 402, headers: {}, body: { error: 'payment_required' } },
        };
      }
      return {
        type: 'payment-verified',
        paymentPayload: { x402Version: 2 },
        paymentRequirements: { scheme: 'exact', network: 'eip155:196' },
        declaredExtensions: {},
      };
    });
    const processSettlement = vi.fn(async () => ({
      success: true,
      headers: { 'payment-response': 'settled-receipt' },
    }));
    const fakeServer = {
      requiresPayment: () => true,
      processHTTPRequest,
      processSettlement,
    };

    const app = express();
    app.use(marketplacePaidReplayAdapter);
    app.use(paymentMiddlewareFromHTTPServer(
      fakeServer as never,
      undefined,
      undefined,
      false,
    ));
    app.post('/v1/daily-flow', (_req, res) => {
      res.json({ service: 'Daily Flow', delivered: true });
    });

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/v1/daily-flow`, {
        headers: { 'X-PAYMENT': 'signed-proof' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ service: 'Daily Flow', delivered: true });
      expect(response.headers.get('payment-response')).toBe('settled-receipt');
      expect(processHTTPRequest).toHaveBeenCalledOnce();
      expect(processSettlement).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('settles a signed empty-body POST replay and returns the Daily plan', async () => {
    const processHTTPRequest = vi.fn(async (context: { paymentHeader?: string }) => {
      if (context.paymentHeader !== 'signed-proof') {
        return {
          type: 'payment-error',
          response: { status: 402, headers: {}, body: { error: 'payment_required' } },
        };
      }
      return {
        type: 'payment-verified',
        paymentPayload: { x402Version: 2 },
        paymentRequirements: { scheme: 'exact', network: 'eip155:196' },
        declaredExtensions: {},
      };
    });
    const processSettlement = vi.fn(async () => ({
      success: true,
      headers: { 'payment-response': 'settled-receipt' },
    }));
    const fakeServer = {
      requiresPayment: () => true,
      processHTTPRequest,
      processSettlement,
    };
    const provider: ContextRoutingProvider = {
      name: 'Google Maps Platform',
      configured: false,
      discover: vi.fn(async () => []),
    };

    const app = express();
    app.use(express.json());
    app.use(marketplacePaidReplayAdapter);
    app.post('/v1/daily-flow', createDailyFlowPrepaymentGuard(provider));
    app.use(paymentMiddlewareFromHTTPServer(
      fakeServer as never,
      undefined,
      undefined,
      false,
    ));
    app.use(createDailyFlowRouter(provider));

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/v1/daily-flow`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'PAYMENT-SIGNATURE': 'signed-proof',
        },
        body: '{}',
      });
      const body = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(response.headers.get('payment-response')).toBe('settled-receipt');
      expect(body.service).toContain('Daily Flow');
      expect(body.food_context_pack).toBe('custom');
      expect(body.meal_structure.breakfast.length).toBeGreaterThan(0);
      expect(body.movement_plan.length).toBeGreaterThan(0);
      expect(body.assumptions[0]).toContain('marketplace replay supplied no personal inputs');
      expect(processHTTPRequest).toHaveBeenCalledOnce();
      expect(processSettlement).toHaveBeenCalledOnce();
      expect(provider.discover).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('prepares a country-optional core plan before settlement when live routing is unavailable', async () => {
    const order: string[] = [];
    const provider: ContextRoutingProvider = {
      name: 'Google Maps Platform',
      configured: false,
      discover: vi.fn(async () => {
        order.push('optional-enrichment-attempted');
        throw new Error('not_configured');
      }),
    };
    const processHTTPRequest = vi.fn(async () => {
      order.push('payment-verified');
      return {
        type: 'payment-verified',
        paymentPayload: { x402Version: 2 },
        paymentRequirements: { scheme: 'exact', network: 'eip155:196' },
        declaredExtensions: {},
      };
    });
    const processSettlement = vi.fn(async () => {
      order.push('payment-settled');
      return {
        success: true,
        headers: { 'payment-response': 'settled-receipt' },
      };
    });
    const fakeServer = {
      requiresPayment: () => true,
      processHTTPRequest,
      processSettlement,
    };

    const app = express();
    app.use(express.json());
    app.post('/v1/daily-flow', createDailyFlowPrepaymentGuard(provider));
    app.use(paymentMiddlewareFromHTTPServer(
      fakeServer as never,
      undefined,
      undefined,
      false,
    ));
    app.use(createDailyFlowRouter(provider));

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/v1/daily-flow`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'PAYMENT-SIGNATURE': 'signed-proof',
        },
        body: JSON.stringify({
          goal: 'maintain',
          profile: {
            age: 30,
            height_cm: 170,
            weight_kg: 70,
            activity_level: 'lightly_active',
          },
          constraints: {
            available_foods: ['rice', 'beans', 'eggs', 'vegetables'],
          },
          real_world_context: {
            location_permission: true,
            origin: { latitude: 6.5244, longitude: 3.3792 },
          },
        }),
      });
      const body = await response.json() as Record<string, any>;

      expect(response.status).toBe(200);
      expect(body.food_context_pack).toBe('custom');
      expect(body.meal_structure.breakfast.length).toBeGreaterThan(0);
      expect(body.context_routing_notice).toContain('core meal and movement plan remains complete');
      expect(order).toEqual([
        'optional-enrichment-attempted',
        'payment-verified',
        'payment-settled',
      ]);
      expect(provider.discover).toHaveBeenCalledOnce();
      expect(processHTTPRequest).toHaveBeenCalledOnce();
      expect(processSettlement).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

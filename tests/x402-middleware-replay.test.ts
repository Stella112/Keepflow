import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { paymentMiddlewareFromHTTPServer } from '@okxweb3/x402-express';
import { marketplacePaidGetReplayAdapter } from '../src/payments/marketplace-replay.js';

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
    app.use(marketplacePaidGetReplayAdapter);
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
});

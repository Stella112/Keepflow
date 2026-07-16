import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('reverse-proxy configuration', () => {
  it('trusts exactly one proxy hop for public HTTPS reconstruction', () => {
    const app = createApp();
    expect(app.get('trust proxy')).toBe(1);
  });
});

describe('payment configuration', () => {
  it('defaults new deployments to five cents per call', () => {
    const previous = process.env.X402_PRICE_USD;
    delete process.env.X402_PRICE_USD;
    try {
      expect(loadConfig().payments.priceUsd).toBe('$0.05');
    } finally {
      if (previous === undefined) delete process.env.X402_PRICE_USD;
      else process.env.X402_PRICE_USD = previous;
    }
  });
});

describe('Daily Flow HTTP route', () => {
  it('serves a validated international checklist through the app', async () => {
    const app = createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));

    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/v1/daily-flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: 'maintain',
          profile: {
            age: 32,
            height_cm: 168,
            weight_kg: 68,
            sex_for_energy_equation: 'female',
            activity_level: 'lightly_active',
          },
          constraints: {
            food_context_pack: 'china',
            allergies: ['peanut'],
            available_foods: ['rice', 'tofu', 'bok choy', 'egg', 'orange'],
          },
          health_screen: {},
        }),
      });
      const body = await response.json() as {
        service: string;
        eligibility: string;
        food_context_pack: string;
      };

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.service).toContain('Daily Flow');
      expect(body.eligibility).toBe('personalized');
      expect(body.food_context_pack).toBe('china');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

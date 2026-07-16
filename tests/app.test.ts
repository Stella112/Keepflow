import { describe, expect, it } from 'vitest';
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

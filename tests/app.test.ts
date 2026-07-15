import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('reverse-proxy configuration', () => {
  it('trusts exactly one proxy hop for public HTTPS reconstruction', () => {
    const app = createApp();
    expect(app.get('trust proxy')).toBe(1);
  });
});

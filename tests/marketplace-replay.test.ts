import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

async function paidGet(path: string): Promise<{ status: number; body: Record<string, any> }> {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { 'X-PAYMENT': 'test-paid-replay' },
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function paidEmptyPost(path: string): Promise<{ status: number; body: Record<string, any> }> {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'PAYMENT-SIGNATURE': 'test-paid-replay',
      },
      body: '{}',
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('visible OKX marketplace paid replays', () => {
  it('delivers First Move & Continuity with artifacts', async () => {
    const result = await paidGet('/v1/continuity-pack');
    expect(result.status).toBe(200);
    expect(result.body.service).toContain('Continuity');
    expect(Object.keys(result.body.artifacts)).toEqual(expect.arrayContaining(['calendar', 'printable_brief', 'editable_brief']));
  });

  it('delivers Daily meal and movement output', async () => {
    const result = await paidGet('/v1/daily-flow');
    expect(result.status).toBe(200);
    expect(result.body.meal_structure.breakfast.length).toBeGreaterThan(0);
    expect(result.body.movement_plan.length).toBeGreaterThan(0);
  });

  it('delivers Study execution and reminders', async () => {
    const result = await paidGet('/v1/study');
    expect(result.status).toBe(200);
    expect(result.body.service).toContain('Study');
    expect(result.body.sessions.length).toBeGreaterThan(0);
    expect(result.body.reminder_pack.event_count).toBeGreaterThan(0);
  });

  it('delivers Work handover output', async () => {
    const result = await paidGet('/v1/work-career');
    expect(result.status).toBe(200);
    expect(result.body.service).toContain('Work');
    expect(result.body.prioritized_items.length).toBeGreaterThan(0);
  });

  it.each([
    ['/v1/continuity-pack', 'Continuity'],
    ['/v1/daily-flow', 'Daily Flow'],
    ['/v1/study', 'Study'],
    ['/v1/work-career', 'Work'],
  ])('delivers %s when a signed POST replay has an empty body', async (path, service) => {
    const result = await paidEmptyPost(path);
    expect(result.status).toBe(200);
    expect(result.body.service).toContain(service);
    expect(result.body.assumptions?.[0] ?? result.body.limitations?.[0] ?? '')
      .not.toContain('invalid_request');
  });
});

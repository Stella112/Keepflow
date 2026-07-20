import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createArtifactCapacityLimiter } from '../src/operational/limits.js';

async function serve(app: express.Express, run: (origin: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const dailyInput = {
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
    allergies: [],
    available_foods: ['rice', 'tofu', 'bok choy', 'egg'],
  },
  health_screen: {},
};

describe('paid-route operational controls', () => {
  it('replays a successful request without executing it twice and rejects key reuse for another body', async () => {
    await serve(createApp(), async (origin) => {
      const key = 'keepflow-retry-key-0000000001';
      const send = (body: unknown) => fetch(`${origin}/v1/daily-flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });
      const first = await send(dailyInput);
      const firstBody = await first.text();
      const replay = await send(dailyInput);
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replay.headers.get('idempotency-replayed')).toBe('true');
      expect(await replay.text()).toBe(firstBody);

      const conflict = await send({ ...dailyInput, goal: 'gradual_gain' });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ error: 'idempotency_key_conflict' });
    });
  });

  it('limits abusive paid-route request bursts before paid processing', async () => {
    await serve(createApp(), async (origin) => {
      let last: Response | undefined;
      for (let index = 0; index < 31; index += 1) {
        last = await fetch(`${origin}/v1/first-move`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
      }
      expect(last?.status).toBe(429);
      expect(last?.headers.get('retry-after')).toBeTruthy();
    });
  });

  it('rejects excess artifact work while one bounded worker is occupied', async () => {
    const app = express();
    app.use(createArtifactCapacityLimiter(1));
    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    let releaseResolve: (() => void) | undefined;
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    app.post('/v1/continuity-pack', async (_req, res) => {
      enteredResolve?.();
      await release;
      res.json({ ok: true });
    });
    await serve(app, async (origin) => {
      const first = fetch(`${origin}/v1/continuity-pack`, { method: 'POST' });
      await entered;
      const second = await fetch(`${origin}/v1/continuity-pack`, { method: 'POST' });
      expect(second.status).toBe(503);
      expect(await second.json()).toMatchObject({ error: 'artifact_capacity_busy' });
      releaseResolve?.();
      expect((await first).status).toBe(200);
    });
  });
});

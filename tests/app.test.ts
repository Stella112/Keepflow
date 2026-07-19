import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { config, loadConfig } from '../src/config.js';
import { PAID_ROUTE_KEYS, PAID_ROUTE_SPECS } from '../src/payments/paid-routes.js';

async function withApp<T>(
  app: ReturnType<typeof createApp>,
  run: (origin: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

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

  it('protects every advertised paid service through one registry', () => {
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
  });

  it('rejects malformed paid input before the payment layer', async () => {
    const previous = { ...config.payments };
    config.payments.enabled = true;
    config.payments.okxConfigured = false;
    config.payments.payToAddress = undefined;
    const app = createApp();
    Object.assign(config.payments, previous);

    await withApp(app, async (origin) => {
      const malformed = await fetch(`${origin}/v1/study-flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: 'invalid_request' });
    });
  });

  it('rejects every non-canonical paid-route alias before it can bypass x402', async () => {
    const previous = { ...config.payments };
    config.payments.enabled = true;
    config.payments.okxConfigured = false;
    config.payments.payToAddress = undefined;
    const app = createApp();
    Object.assign(config.payments, previous);

    await withApp(app, async (origin) => {
      const canonical = await fetch(`${origin}/v1/first-move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'My phone was stolen.' }),
      });
      expect(canonical.status).toBe(500);
      expect(await canonical.json()).toMatchObject({ error: 'payment_misconfigured' });

      const aliases = PAID_ROUTE_SPECS.flatMap((route) => [
        `${route.path}/`,
        route.path.toUpperCase(),
        `${route.path}//`,
      ]);
      aliases.push('/v1/%66irst-move');

      for (const alias of aliases) {
        const response = await fetch(`${origin}${alias}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        expect(response.status, alias).toBe(404);
        expect(await response.json(), alias).toMatchObject({
          error: 'non_canonical_paid_route',
        });
      }
    });
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

describe('Study and Work HTTP routes', () => {
  it('serves both new services through the complete app stack', async () => {
    await withApp(createApp(), async (origin) => {
      const study = await fetch(`${origin}/v1/study-flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: 'Prepare the declared mathematics assignment',
          planning_started_at: '2026-07-16T09:00:00+08:00',
          timezone: 'Asia/Shanghai',
          goal_deadline: '2026-07-18T18:00:00+08:00',
          tasks: [{
            id: 'math-review',
            subject: 'Mathematics',
            title: 'Review the assigned practice problems',
            kind: 'revision',
            estimated_minutes: 60,
            due_at: '2026-07-18T18:00:00+08:00',
            materials: ['Teacher-provided practice sheet'],
          }],
          available_windows: [{
            id: 'evening-one',
            starts_at: '2026-07-16T18:00:00+08:00',
            minutes: 90,
          }],
          preferences: {},
        }),
      });
      const studyBody = await study.json() as { service: string; sessions: unknown[] };
      expect(study.status).toBe(200);
      expect(study.headers.get('cache-control')).toBe('no-store');
      expect(studyBody.service).toBe('KeepFlow Study - Academic Execution');
      expect(studyBody.sessions.length).toBeGreaterThan(0);

      const work = await fetch(`${origin}/v1/work-handover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          handover_title: 'Customer reporting handover',
          objective: 'Maintain the approved weekly reporting process.',
          as_of: '2026-07-16T10:00:00+01:00',
          timezone: 'Africa/Lagos',
          tasks: [{
            id: 'report-check',
            title: 'Validate the report export',
            owner: 'Reporting lead',
            status: 'in_progress',
            priority: 'high',
            next_action: 'Compare totals with the approved source snapshot.',
            due_at: '2026-07-17T16:00:00+01:00',
            definition_of_done: 'Reviewer confirms that the totals match.',
            escalation_trigger: 'Totals still differ after the documented recheck.',
          }],
        }),
      });
      const workBody = await work.json() as { service: string; handover_checklist: unknown[] };
      expect(work.status).toBe(200);
      expect(work.headers.get('cache-control')).toBe('no-store');
      expect(workBody.service).toBe('KeepFlow Work - Operational Handover');
      expect(workBody.handover_checklist.length).toBeGreaterThan(0);
    });
  });

  it('rejects Work credentials before generation and never echoes them', async () => {
    await withApp(createApp(), async (origin) => {
      const secret = `sk-${'a'.repeat(32)}`;
      const response = await fetch(`${origin}/v1/work-handover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          handover_title: 'Access handover',
          objective: `Give the next operator this API token: ${secret}`,
          tasks: [{ id: 'access', title: 'Transfer access details' }],
        }),
      });
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(text).not.toContain(secret);
      expect(text).toContain('sensitive_data_detected');
    });
  });
});

describe('Reminder Pack HTTP route', () => {
  const validReminder = {
    calendar_name: 'KeepFlow Week',
    timezone: 'Africa/Lagos',
    events: [{
      id: 'study-001',
      title: 'Review cellular respiration',
      starts_at: '2035-07-16T18:00:00+01:00',
      duration_minutes: 45,
      alert_minutes_before: 15,
      source_service: 'study',
    }],
  };

  it('serves an importable calendar alarm through the complete app stack', async () => {
    await withApp(createApp(), async (origin) => {
      const response = await fetch(`${origin}/v1/reminder-pack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validReminder),
      });
      const body = await response.json() as {
        delivery_mode: string;
        event_count: number;
        calendar_file: { content_base64: string };
      };
      const calendar = Buffer.from(body.calendar_file.content_base64, 'base64').toString('utf8');

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.delivery_mode).toBe('calendar_import');
      expect(body.event_count).toBe(1);
      expect(calendar).toContain('BEGIN:VALARM');
    });
  });

  it('rejects stale or secret-bearing events before the payment layer', async () => {
    const previous = { ...config.payments };
    config.payments.enabled = true;
    config.payments.okxConfigured = false;
    config.payments.payToAddress = undefined;
    const app = createApp();
    Object.assign(config.payments, previous);

    await withApp(app, async (origin) => {
      const stale = await fetch(`${origin}/v1/reminder-pack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...validReminder,
          events: [{ ...validReminder.events[0], starts_at: '2020-01-01T00:00:00+00:00' }],
        }),
      });
      expect(stale.status).toBe(400);

      const secret = `sk-${'a'.repeat(32)}`;
      const sensitive = await fetch(`${origin}/v1/reminder-pack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...validReminder,
          events: [{ ...validReminder.events[0], note: `API key: ${secret}` }],
        }),
      });
      const text = await sensitive.text();
      expect(sensitive.status).toBe(400);
      expect(text).toContain('sensitive_input_detected');
      expect(text).not.toContain(secret);
    });
  });
});

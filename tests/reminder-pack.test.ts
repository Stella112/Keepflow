import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import {
  buildReminderPack,
  validateReminderPack,
} from '../src/engine/reminder-pack.js';
import {
  ReminderPackInputSchema,
  type ReminderPackInput,
} from '../src/schemas/reminder-pack-input.js';
import { reminderPackRouter } from '../src/routes/reminder-pack.js';

function makeInput(overrides: Record<string, unknown> = {}): ReminderPackInput {
  return ReminderPackInputSchema.parse({
    calendar_name: 'KeepFlow Study Week',
    timezone: 'Africa/Lagos',
    events: [
      {
        id: 'study-001',
        title: 'Review ATP synthesis, then self-check',
        starts_at: '2035-07-16T18:00:00+01:00',
        duration_minutes: 45,
        alert_minutes_before: 15,
        note: 'Use the supplied notes; record what remains unclear.',
        source_service: 'study',
      },
      {
        id: 'work-001',
        title: 'Validate report export',
        starts_at: '2035-07-17T09:30:00+01:00',
        duration_minutes: 30,
        alert_minutes_before: 0,
        source_service: 'work',
      },
    ],
    ...overrides,
  });
}

async function postToRouter(body: unknown) {
  const app = express();
  app.use(express.json());
  app.use(reminderPackRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/v1/reminder-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('KeepFlow Reminder Pack', () => {
  it('builds a valid, stateless calendar with one alarm per event', () => {
    const input = makeInput();
    const output = buildReminderPack(input, new Date('2035-07-15T12:00:00.000Z'));
    const bytes = Buffer.from(output.calendar_file.content_base64, 'base64');
    const calendar = bytes.toString('utf8');

    expect(output.delivery_mode).toBe('calendar_import');
    expect(output.event_count).toBe(2);
    expect(output.meta).toMatchObject({
      stateless: true,
      stores_reminders: false,
      sends_background_notifications: false,
    });
    expect(calendar.match(/BEGIN:VEVENT\r\n/g)).toHaveLength(2);
    expect(calendar.match(/BEGIN:VALARM\r\n/g)).toHaveLength(2);
    expect(calendar).toContain('DTSTART:20350716T170000Z');
    expect(calendar).toContain('TRIGGER:-PT15M');
    expect(calendar).toContain('TRIGGER:PT0M');
    expect(output.calendar_file.sha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(validateReminderPack(output, input)).toEqual({ valid: true, errors: [] });
  });

  it('escapes calendar control characters and folds UTF-8 lines safely', () => {
    const input = makeInput({
      calendar_name: 'KeepFlow, reminders; safe',
      events: [{
        id: 'unicode',
        title: '学习计划, focus; now\nDESCRIPTION:injected',
        starts_at: '2035-07-18T10:00:00+08:00',
        duration_minutes: 30,
        alert_minutes_before: 10,
        note: 'A'.repeat(150),
        source_service: 'study',
      }],
    });
    const output = buildReminderPack(input, new Date('2035-07-15T12:00:00.000Z'));
    const calendar = Buffer.from(output.calendar_file.content_base64, 'base64').toString('utf8');

    expect(calendar).toContain('SUMMARY:学习计划\\, focus\\; now\\nDESCRIPTION:injected');
    expect(calendar).not.toContain('\r\nDESCRIPTION:injected\r\n');
    for (const line of calendar.split('\r\n').filter(Boolean)) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
  });

  it('detects a calendar or event changed after generation', () => {
    const input = makeInput();
    const output = buildReminderPack(input, new Date('2035-07-15T12:00:00.000Z'));
    const changedEvent = structuredClone(output);
    changedEvent.events[0]!.starts_at = '2035-07-16T19:00:00+01:00';
    expect(validateReminderPack(changedEvent, input).valid).toBe(false);

    const changedCalendar = structuredClone(output);
    const text = Buffer.from(changedCalendar.calendar_file.content_base64, 'base64')
      .toString('utf8')
      .replace('Review ATP synthesis', 'Altered calendar text');
    const bytes = Buffer.from(text, 'utf8');
    changedCalendar.calendar_file.content_base64 = bytes.toString('base64');
    changedCalendar.calendar_file.sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(validateReminderPack(changedCalendar, input).errors).toContain(
      'calendar content does not match the validated input',
    );
  });

  it('rejects duplicate ids, invalid timezones, past events, and excessive bounds', () => {
    const base = makeInput();
    expect(ReminderPackInputSchema.safeParse({
      ...base,
      timezone: 'Mars/Olympus',
    }).success).toBe(false);
    expect(ReminderPackInputSchema.safeParse({
      ...base,
      events: [base.events[0], { ...base.events[1], id: base.events[0]!.id }],
    }).success).toBe(false);
    expect(ReminderPackInputSchema.safeParse({
      ...base,
      events: [{ ...base.events[0], starts_at: '2020-01-01T00:00:00+00:00' }],
    }).success).toBe(false);
    expect(ReminderPackInputSchema.safeParse({
      ...base,
      events: [{ ...base.events[0], alert_minutes_before: 10_081 }],
    }).success).toBe(false);
    expect(ReminderPackInputSchema.safeParse({
      ...base,
      events: [{ ...base.events[0], title: 'Unsafe\u0000title' }],
    }).success).toBe(false);
  });

  it('serves a validated calendar pack and never stores or sends reminders itself', async () => {
    const response = await postToRouter(makeInput());
    expect(response.status).toBe(200);
    const body = JSON.parse(response.text) as ReturnType<typeof buildReminderPack>;
    expect(body.calendar_file.filename).toBe('keepflow-study-week.ics');
    expect(body.limitations.join(' ')).toMatch(/does not store.*background notification/i);
  });

  it('rejects secret-bearing reminder content without echoing the secret', async () => {
    const secret = `sk-${'a'.repeat(32)}`;
    const input = makeInput({
      events: [{
        ...makeInput().events[0],
        note: `Use this API key: ${secret}`,
      }],
    });
    const response = await postToRouter(input);
    expect(response.status).toBe(400);
    expect(response.text).not.toContain(secret);
    expect(response.text).toContain('sensitive_input_detected');
  });
});

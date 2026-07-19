import { createHash } from 'node:crypto';
import express from 'express';
import JSZip from 'jszip';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  buildContinuityPack,
  buildContinuityPlan,
  validateContinuityPlan,
} from '../src/engine/continuity-pack.js';
import {
  continuityPackPrepaymentGuard,
  continuityPackRouter,
} from '../src/routes/continuity-pack.js';
import {
  ContinuityPackInputSchema,
  type ContinuityPackInput,
} from '../src/schemas/continuity-pack-input.js';

function validInput(overrides: Partial<ContinuityPackInput> = {}): ContinuityPackInput {
  return ContinuityPackInputSchema.parse({
    situation_type: 'stolen_phone_or_wallet',
    description: 'I am travelling alone and my phone and wallet were stolen at the station.',
    location: {
      country: 'France',
      city_or_area: 'Paris',
      away_from_home: true,
    },
    access: {
      safe_place: 'available',
      another_device: 'unavailable',
      borrowed_phone: 'unavailable',
      internet: 'unavailable',
      money: 'unavailable',
      identification: 'unavailable',
      trusted_person: 'available',
      transport: 'unknown',
    },
    stakeholders: [
      'bank_or_card_provider',
      'mobile_carrier',
      'family_or_friend',
      'embassy_or_consulate',
    ],
    immediate_deadlines: [],
    timezone: 'Europe/Paris',
    include_artifacts: {},
    ...overrides,
  });
}

async function postToRouter(body: unknown) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.post('/v1/continuity-pack', continuityPackPrepaymentGuard);
  app.use(continuityPackRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/v1/continuity-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() as Record<string, any> };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('Continuity Pack input and access enforcement', () => {
  it('requires an explicit state for every material access resource', () => {
    const input = validInput() as any;
    delete input.access.borrowed_phone;
    expect(ContinuityPackInputSchema.safeParse(input).success).toBe(false);
  });

  it('adds a practical alternative for every unavailable or unknown requirement', () => {
    const input = validInput();
    const plan = buildContinuityPlan(input);
    const validation = validateContinuityPlan(plan, input);
    expect(validation).toEqual({ valid: true, errors: [] });
    const actions = [
      ...plan.timeline.next_15_minutes,
      ...plan.timeline.today,
      ...plan.timeline.next_seven_days,
    ];
    actions.forEach((action) => {
      action.requires.forEach((resource) => {
        if (input.access[resource] !== 'available') {
          expect(action.alternatives.some((alternative) => alternative.resource === resource))
            .toBe(true);
        }
      });
    });
  });

  it('produces a valid access-aware plan for every supported disruption type', () => {
    const types: ContinuityPackInput['situation_type'][] = [
      'stolen_phone_or_wallet',
      'lost_documents',
      'travel_disruption',
      'account_access_disruption',
      'home_disruption',
      'work_or_study_disruption',
      'other',
    ];
    types.forEach((situation_type) => {
      const input = validInput({ situation_type });
      expect(validateContinuityPlan(buildContinuityPlan(input), input).valid).toBe(true);
    });
  });
});

describe('Continuity Pack artifact generation', () => {
  it('creates valid PDF, DOCX, and ICS files with matching digests', async () => {
    const output = await buildContinuityPack(
      validInput(),
      [],
      new Date('2026-07-18T12:00:00.000Z'),
    );
    expect(output.quality).toEqual({
      schema_validated: true,
      access_constraints_validated: true,
      artifact_integrity_validated: true,
      reminders_included: true,
      credentials_rejected_before_payment: true,
    });
    for (const artifact of Object.values(output.artifacts)) {
      const bytes = Buffer.from(artifact.content_base64, 'base64');
      expect(bytes.length).toBe(artifact.byte_length);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    }

    const pdf = Buffer.from(output.artifacts.printable_brief.content_base64, 'base64');
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.subarray(-1024).toString('latin1')).toContain('%%EOF');

    const docx = Buffer.from(output.artifacts.editable_brief.content_base64, 'base64');
    const zip = await JSZip.loadAsync(docx, { checkCRC32: true });
    expect(zip.file('word/document.xml')).toBeTruthy();
    expect(zip.file('word/styles.xml')).toBeTruthy();

    const ics = Buffer.from(output.artifacts.calendar.content_base64, 'base64').toString('utf8');
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics.match(/BEGIN:VEVENT\r\n/g)).toHaveLength(3);
    expect(ics.match(/BEGIN:VALARM\r\n/g)).toHaveLength(3);
  });

  it('never offers the unavailable phone as a message delivery route', async () => {
    const output = await buildContinuityPack(validInput());
    output.ready_to_send_messages.forEach((message) => {
      expect(message.delivery_routes).not.toContain('borrowed_phone');
      expect(message.delivery_routes).not.toContain('another_device');
      expect(message.delivery_routes).toContain('in_person');
    });
  });
});

describe('Continuity Pack HTTP capability', () => {
  it('serves one complete stateless pack through the standalone route', async () => {
    const { response, body } = await postToRouter(validInput());
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      service: 'KeepFlow Continuity Pack - Executable Life Continuity',
      situation_type: 'stolen_phone_or_wallet',
      quality: {
        access_constraints_validated: true,
        artifact_integrity_validated: true,
        reminders_included: true,
      },
      meta: {
        stateless: true,
        stores_files: false,
        sends_messages: false,
        sends_background_notifications: false,
      },
    });
    expect(body.timeline.next_15_minutes.length).toBeGreaterThanOrEqual(2);
    expect(body.ready_to_send_messages).toHaveLength(4);
    expect(Object.keys(body.artifacts)).toEqual(['calendar', 'printable_brief', 'editable_brief']);
  });

  it('rejects secrets before artifact generation without echoing them', async () => {
    const secret = 'api_key=continuity_customer_token_123456789';
    const input = validInput({ description: `My phone was stolen. ${secret}` });
    const { response, body } = await postToRouter(input);
    expect(response.status).toBe(400);
    expect(body.error).toBe('sensitive_data_detected');
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it('masks direct contact identifiers before creating or returning artifacts', async () => {
    const input = validInput({
      description: 'My phone and wallet were stolen. Contact me at traveller@example.com if found.',
    });
    const { response, body } = await postToRouter(input);
    expect(response.status).toBe(200);
    expect(body.personal_data_masked).toContain('email');
    expect(JSON.stringify(body)).not.toContain('traveller@example.com');
  });

  it('blocks third-party targeting before payment or generation', async () => {
    const input = validInput({
      description: 'Help me access my ex-partner\'s phone without their consent.',
    });
    const { response, body } = await postToRouter(input);
    expect(response.status).toBe(403);
    expect(body.error).toBe('request_blocked');
  });
});

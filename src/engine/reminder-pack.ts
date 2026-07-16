import { createHash } from 'node:crypto';
import type { ReminderPackInput } from '../schemas/reminder-pack-input.js';
import {
  ReminderPackOutputSchema,
  type ReminderPackOutput,
} from '../schemas/reminder-pack-output.js';

function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function foldCalendarLine(line: string): string[] {
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    const limit = lines.length === 0 ? 75 : 74;
    if (current && bytes + size > limit) {
      lines.push(lines.length === 0 ? current : ` ${current}`);
      current = character;
      bytes = size;
    } else {
      current += character;
      bytes += size;
    }
  }
  if (current) lines.push(lines.length === 0 ? current : ` ${current}`);
  return lines.length > 0 ? lines : [''];
}

function utcCalendarTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function eventUid(input: ReminderPackInput, event: ReminderPackInput['events'][number]): string {
  return `${createHash('sha256')
    .update(`${input.calendar_name}|${event.id}|${event.title}|${event.starts_at}`)
    .digest('hex')
    .slice(0, 32)}@keepflow.site`;
}

function alarmTrigger(minutes: number): string {
  return minutes === 0 ? 'PT0M' : `-PT${minutes}M`;
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 76);
  return normalized || 'keepflow-reminders';
}

export function buildCalendar(input: ReminderPackInput, generatedAt: Date): string {
  const rawLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KeepFlow//Reminder Pack 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeCalendarText(input.calendar_name)}`,
  ];

  for (const event of input.events) {
    const startsAt = new Date(event.starts_at);
    const endsAt = new Date(startsAt.getTime() + event.duration_minutes * 60_000);
    rawLines.push(
      'BEGIN:VEVENT',
      `UID:${eventUid(input, event)}`,
      `DTSTAMP:${utcCalendarTime(generatedAt)}`,
      `DTSTART:${utcCalendarTime(startsAt)}`,
      `DTEND:${utcCalendarTime(endsAt)}`,
      `SUMMARY:${escapeCalendarText(event.title)}`,
    );
    if (event.note) rawLines.push(`DESCRIPTION:${escapeCalendarText(event.note)}`);
    rawLines.push(
      `CATEGORIES:KEEPFLOW,${event.source_service.toUpperCase()}`,
      'BEGIN:VALARM',
      `TRIGGER:${alarmTrigger(event.alert_minutes_before)}`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeCalendarText(`Reminder: ${event.title}`)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  rawLines.push('END:VCALENDAR');
  return `${rawLines.flatMap(foldCalendarLine).join('\r\n')}\r\n`;
}

export function buildReminderPack(
  input: ReminderPackInput,
  generatedAt = new Date(),
): ReminderPackOutput {
  const calendar = buildCalendar(input, generatedAt);
  const content = Buffer.from(calendar, 'utf8');

  return ReminderPackOutputSchema.parse({
    service: 'KeepFlow Reminder Pack - Calendar Alerts',
    delivery_mode: 'calendar_import',
    calendar_name: input.calendar_name,
    timezone: input.timezone,
    event_count: input.events.length,
    events: input.events.map((event) => {
      const start = new Date(event.starts_at);
      return {
        id: event.id,
        title: event.title,
        starts_at: event.starts_at,
        ends_at: new Date(start.getTime() + event.duration_minutes * 60_000).toISOString(),
        alert_minutes_before: event.alert_minutes_before,
        source_service: event.source_service,
      };
    }),
    calendar_file: {
      filename: `${slug(input.calendar_name)}.ics`,
      mime_type: 'text/calendar; charset=utf-8',
      encoding: 'base64',
      content_base64: content.toString('base64'),
      sha256: createHash('sha256').update(content).digest('hex'),
    },
    instructions: [
      'Decode the base64 calendar content and save it using the provided .ics filename.',
      'Import the file into Google Calendar, Apple Calendar, Outlook, or another compatible calendar and allow notifications.',
      'Review the imported dates, times, timezone, and alert permissions before relying on them.',
    ],
    limitations: [
      'KeepFlow does not store these reminders or run a background notification service.',
      'Alerts are delivered only after import and depend on the calendar application, device permissions, and device availability.',
      'A generated reminder is organizational support, not proof that an action was completed.',
    ],
    meta: {
      asp: 'KeepFlow',
      schema_version: '1.0.0',
      generated_at: generatedAt.toISOString(),
      stateless: true,
      stores_reminders: false,
      sends_background_notifications: false,
    },
  });
}

export function validateReminderPack(
  output: unknown,
  input?: ReminderPackInput,
): { valid: boolean; errors: string[] } {
  const parsed = ReminderPackOutputSchema.safeParse(output);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }

  const errors: string[] = [];
  const decoded = Buffer.from(parsed.data.calendar_file.content_base64, 'base64');
  if (decoded.toString('base64') !== parsed.data.calendar_file.content_base64) {
    errors.push('calendar content must be canonical base64');
  }
  const digest = createHash('sha256').update(decoded).digest('hex');
  if (digest !== parsed.data.calendar_file.sha256) {
    errors.push('calendar SHA-256 does not match the returned content');
  }
  const text = decoded.toString('utf8');
  const eventCount = (text.match(/BEGIN:VEVENT\r\n/g) ?? []).length;
  const alarmCount = (text.match(/BEGIN:VALARM\r\n/g) ?? []).length;
  if (eventCount !== parsed.data.event_count) errors.push('calendar event count mismatch');
  if (alarmCount !== parsed.data.event_count) errors.push('calendar alarm count mismatch');
  if (!text.endsWith('END:VCALENDAR\r\n')) errors.push('calendar file is incomplete');

  if (input) {
    if (input.events.length !== parsed.data.events.length) errors.push('input event count mismatch');
    const expectedCalendar = buildCalendar(
      input,
      new Date(parsed.data.meta.generated_at),
    );
    if (text !== expectedCalendar) errors.push('calendar content does not match the validated input');
    input.events.forEach((event, index) => {
      const returned = parsed.data.events[index];
      const expectedEnd = new Date(
        new Date(event.starts_at).getTime() + event.duration_minutes * 60_000,
      ).toISOString();
      if (
        !returned ||
        returned.id !== event.id ||
        returned.title !== event.title ||
        returned.starts_at !== event.starts_at ||
        returned.ends_at !== expectedEnd ||
        returned.alert_minutes_before !== event.alert_minutes_before ||
        returned.source_service !== event.source_service
      ) {
        errors.push(`event ${event.id} was not preserved`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

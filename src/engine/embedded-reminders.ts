import { buildReminderPack, validateReminderPack } from './reminder-pack.js';
import type { ReminderPackInput } from '../schemas/reminder-pack-input.js';
import type { ReminderPackOutput } from '../schemas/reminder-pack-output.js';

export interface EmbeddedReminderEvent {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes?: number;
  alert_minutes_before?: number;
  description?: string;
  source_service: 'daily_flow' | 'first_move' | 'study' | 'work' | 'custom';
}

/**
 * Build an importable reminder pack only when a service produced actionable,
 * future-dated work. Invalid or already-stale timestamps are omitted rather
 * than making an otherwise useful plan fail after payment.
 */
export function buildEmbeddedReminderPack(options: {
  calendarName: string;
  timezone: string;
  events: EmbeddedReminderEvent[];
  now?: Date;
}): ReminderPackOutput | undefined {
  const now = options.now ?? new Date();
  const threshold = now.getTime() + 10 * 60_000;
  const events = options.events
    .filter((event) => Number.isFinite(Date.parse(event.starts_at)) && Date.parse(event.starts_at) > threshold)
    .slice(0, 50)
    .map((event) => ({
      id: event.id,
      title: event.title,
      starts_at: event.starts_at,
      duration_minutes: event.duration_minutes ?? 30,
      alert_minutes_before: event.alert_minutes_before ?? 30,
      description: event.description,
      source_service: event.source_service,
    }));

  if (events.length === 0) return undefined;

  const input: ReminderPackInput = {
    calendar_name: options.calendarName,
    timezone: options.timezone,
    events,
  };
  const output = buildReminderPack(input, now);
  const validation = validateReminderPack(output, input);
  if (!validation.valid) {
    throw new Error(`embedded reminder validation failed: ${validation.errors.join('; ')}`);
  }
  return output;
}

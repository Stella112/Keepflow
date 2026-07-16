import { z } from 'zod';

const ReminderEventOutputSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    alert_minutes_before: z.number().int().min(0).max(10_080),
    source_service: z.enum(['daily_flow', 'first_move', 'study', 'work', 'custom']),
  })
  .strict();

export const ReminderPackOutputSchema = z
  .object({
    service: z.literal('KeepFlow Reminder Pack - Calendar Alerts'),
    delivery_mode: z.literal('calendar_import'),
    calendar_name: z.string().min(1),
    timezone: z.string().min(1),
    event_count: z.number().int().min(1).max(50),
    events: z.array(ReminderEventOutputSchema).min(1).max(50),
    calendar_file: z
      .object({
        filename: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}\.ics$/),
        mime_type: z.literal('text/calendar; charset=utf-8'),
        encoding: z.literal('base64'),
        content_base64: z.string().min(1).max(500_000),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    instructions: z.array(z.string().min(1)).min(2).max(5),
    limitations: z.array(z.string().min(1)).min(2).max(5),
    meta: z
      .object({
        asp: z.literal('KeepFlow'),
        schema_version: z.literal('1.0.0'),
        generated_at: z.string().datetime(),
        stateless: z.literal(true),
        stores_reminders: z.literal(false),
        sends_background_notifications: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.event_count !== value.events.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['event_count'],
        message: 'event_count must equal the number of events',
      });
    }
  });

export type ReminderPackOutput = z.infer<typeof ReminderPackOutputSchema>;

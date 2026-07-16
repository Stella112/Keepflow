import { z } from 'zod';

const UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ShortText = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !UNSAFE_CONTROL_RE.test(value), 'text contains an unsupported control character');
const DetailText = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !UNSAFE_CONTROL_RE.test(value), 'text contains an unsupported control character');
const EventId = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

const ReminderEventSchema = z
  .object({
    id: EventId,
    title: ShortText,
    starts_at: z.string().datetime({ offset: true }),
    duration_minutes: z.number().int().min(5).max(1_440).default(30),
    alert_minutes_before: z.number().int().min(0).max(10_080).default(15),
    note: DetailText.optional(),
    source_service: z
      .enum(['daily_flow', 'first_move', 'study', 'work', 'custom'])
      .default('custom'),
  })
  .strict();

export const ReminderPackInputSchema = z
  .object({
    calendar_name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => !UNSAFE_CONTROL_RE.test(value), 'text contains an unsupported control character')
      .default('KeepFlow Reminders'),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isSupportedTimeZone, 'timezone must be supported by the server IANA database'),
    events: z.array(ReminderEventSchema).min(1).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.events.forEach((event, index) => {
      if (ids.has(event.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['events', index, 'id'],
          message: 'event ids must be unique',
        });
      }
      ids.add(event.id);

      if (new Date(event.starts_at).getTime() <= Date.now() + 10 * 60_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['events', index, 'starts_at'],
          message: 'reminders must start at least ten minutes in the future',
        });
      }
    });
  });

export type ReminderPackInput = z.infer<typeof ReminderPackInputSchema>;

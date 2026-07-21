import { z } from 'zod';
import { CareerPackInputSchema } from './career-pack-input.js';
import { WorkHandoverInputSchema } from './work-handover-input.js';

export const WorkCareerInputSchema = z.object({
  mode: z.enum(['handover', 'career']),
  request: z.union([WorkHandoverInputSchema, CareerPackInputSchema]),
}).strict().superRefine((value, ctx) => {
  const expected = value.mode === 'handover' ? WorkHandoverInputSchema : CareerPackInputSchema;
  if (!expected.safeParse(value.request).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['request'], message: `request must match ${value.mode} mode` });
  }
});

export type WorkCareerInput = z.infer<typeof WorkCareerInputSchema>;

import { z } from 'zod';
import { StudyAssistInputSchema } from './study-assist-input.js';
import { StudyFlowInputSchema } from './study-flow-input.js';

export const StudyServiceInputSchema = z.object({
  mode: z.enum(['plan', 'assist']),
  request: z.union([StudyFlowInputSchema, StudyAssistInputSchema]),
}).strict().superRefine((value, ctx) => {
  const expected = value.mode === 'plan' ? StudyFlowInputSchema : StudyAssistInputSchema;
  if (!expected.safeParse(value.request).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['request'], message: `request must match ${value.mode} mode` });
  }
});

export type StudyServiceInput = z.infer<typeof StudyServiceInputSchema>;

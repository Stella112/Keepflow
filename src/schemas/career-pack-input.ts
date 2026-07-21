import { z } from 'zod';

const Short = z.string().trim().min(1).max(200);
const Detail = z.string().trim().min(1).max(1_200);

const ExperienceSchema = z.object({
  organization: Short,
  role: Short,
  period: Short,
  achievements: z.array(Detail).min(1).max(12),
}).strict();

export const CareerPackInputSchema = z.object({
  target_role: Short,
  target_organization: Short.optional(),
  job_description: z.string().trim().min(40).max(12_000),
  candidate: z.object({
    name: Short,
    contact_line: Short.optional(),
    location: Short.optional(),
    professional_summary_facts: z.array(Detail).min(1).max(12),
    skills: z.array(Short).min(1).max(50),
    experience: z.array(ExperienceSchema).min(1).max(20),
    education: z.array(Detail).max(12).default([]),
    certifications: z.array(Detail).max(12).default([]),
  }).strict(),
  preferences: z.object({
    tone: z.enum(['direct', 'warm', 'formal']).default('direct'),
    include_cover_letter: z.boolean().default(true),
    include_interview_prep: z.boolean().default(true),
  }).strict().default({}),
  application_deadline: z.string().datetime({ offset: true }).optional(),
  interview_at: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  truthfulness_acknowledged: z.literal(true),
}).strict();

export type CareerPackInput = z.infer<typeof CareerPackInputSchema>;

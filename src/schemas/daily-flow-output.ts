import { z } from 'zod';
import { ContextRoutingOutputSchema } from './context-routing-output.js';
import { ReminderPackOutputSchema } from './reminder-pack-output.js';

const ChecklistItemSchema = z
  .object({
    step: z.number().int().positive(),
    task: z.string().min(1),
    target: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const MealOptionSchema = z
  .object({
    foods: z.array(z.string().min(1)).min(1),
    structure: z.string().min(1),
    constraint_reasons: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const DailyFlowOutputSchema = z
  .object({
    service: z.literal('Daily Flow - Constraint-Aware Meal & Movement Checklist'),
    eligibility: z.enum(['personalized', 'general_only', 'professional_review']),
    goal_summary: z.string().min(1),
    food_context_pack: z.string().min(1),
    rule_set_id: z.literal('daily-flow/adult-general-wellness'),
    rule_set_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    estimated_daily_energy: z
      .object({
        method: z.literal('mifflin_st_jeor_v1'),
        lower_kcal: z.number().int().positive(),
        upper_kcal: z.number().int().positive(),
        planning_note: z.string().min(1),
      })
      .strict()
      .nullable(),
    daily_checklist: z.array(ChecklistItemSchema).min(1),
    meal_structure: z
      .object({
        breakfast: z.array(MealOptionSchema),
        lunch: z.array(MealOptionSchema),
        dinner: z.array(MealOptionSchema),
        snacks: z.array(MealOptionSchema),
      })
      .strict(),
    movement_plan: z.array(z.string().min(1)),
    allergy_controls: z
      .object({
        declared_allergens: z.array(z.string()),
        excluded_foods: z.array(z.string()),
        label_check_required: z.boolean(),
        cross_contact_check_required: z.boolean(),
        safety_certification: z.literal(false),
        statement: z.string().min(1),
      })
      .strict(),
    constraint_trace: z.array(
      z
        .object({
          constraint: z.string().min(1),
          effect: z.string().min(1),
        })
        .strict(),
    ),
    professional_review_flags: z.array(z.string().min(1)),
    assumptions: z.array(z.string().min(1)),
    questions: z.array(z.string().min(1)).max(5),
    limitations: z.array(z.string().min(1)),
    context_routing: ContextRoutingOutputSchema.optional(),
    context_routing_notice: z.string().min(1).optional(),
    reminder_pack: ReminderPackOutputSchema.optional(),
    meta: z
      .object({
        asp: z.literal('KeepFlow'),
        schema_version: z.literal('1.0.0'),
        generated_at: z.string().datetime(),
        stores_health_data: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.eligibility === 'professional_review') {
      if (value.estimated_daily_energy !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['estimated_daily_energy'],
          message: 'professional-review responses must not provide an energy target',
        });
      }
      const meals = value.meal_structure;
      if (meals.breakfast.length + meals.lunch.length + meals.dinner.length + meals.snacks.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['meal_structure'],
          message: 'professional-review responses must not provide personalized meals',
        });
      }
    }
  });

export type DailyFlowOutput = z.infer<typeof DailyFlowOutputSchema>;

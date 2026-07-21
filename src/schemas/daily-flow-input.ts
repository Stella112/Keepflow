import { z } from 'zod';
import { ContextEnrichmentRequestSchema } from './context-routing-input.js';

const ShortText = z.string().trim().min(1).max(120);

export const DailyFlowInputSchema = z
  .object({
    goal: z.enum(['gradual_loss', 'gradual_gain', 'maintain']),
    profile: z
      .object({
        age: z.number().int().min(1).max(120),
        height_cm: z.number().min(80).max(250),
        weight_kg: z.number().min(20).max(500),
        /** Used only by the versioned energy equation, never as identity data. */
        sex_for_energy_equation: z.enum(['female', 'male']).optional(),
        activity_level: z.enum([
          'sedentary',
          'lightly_active',
          'moderately_active',
          'very_active',
        ]),
        target_weight_kg: z.number().min(20).max(500).optional(),
      })
      .strict(),
    constraints: z
      .object({
        food_context_pack: z
          .enum([
            'nigeria', 'ghana', 'kenya', 'south_africa', 'egypt', 'ethiopia',
            'china', 'india', 'japan', 'indonesia', 'philippines', 'vietnam',
            'united_kingdom', 'france', 'germany', 'italy', 'spain', 'poland',
            'united_states', 'canada', 'mexico',
            'brazil', 'argentina', 'colombia', 'peru',
            'australia', 'new_zealand', 'middle_east', 'custom',
          ])
          .default('custom'),
        country_or_food_context: ShortText.optional(),
        diet_pattern: z
          .enum(['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'custom'])
          .default('omnivore'),
        allergies: z.array(ShortText).max(20).default([]),
        intolerances: z.array(ShortText).max(20).default([]),
        avoid: z.array(ShortText).max(30).default([]),
        available_foods: z.array(ShortText).min(3).max(60),
        budget: z.enum(['low', 'moderate', 'flexible']).default('moderate'),
        cooking_access: z
          .enum(['none', 'basic', 'full_kitchen', 'cook_once_daily'])
          .default('basic'),
        movement_access: z
          .enum(['walking_only', 'home_workouts', 'gym', 'limited_mobility'])
          .default('walking_only'),
        movement_days_per_week: z.number().int().min(0).max(7).default(3),
        minutes_available: z.number().int().min(5).max(180).default(30),
      })
      .strict(),
    health_screen: z
      .object({
        pregnant: z.boolean().default(false),
        breastfeeding: z.boolean().default(false),
        eating_disorder_or_recovery: z.boolean().default(false),
        sudden_unexplained_weight_change: z.boolean().default(false),
        active_allergy_symptoms: z.boolean().default(false),
        serious_kidney_liver_heart_or_metabolic_condition: z.boolean().default(false),
      })
      .strict()
      .default({}),
    schedule: z
      .object({
        timezone: z.string().trim().min(1).max(64),
        starts_at: z.string().datetime({ offset: true }),
        days: z.number().int().min(1).max(14).default(7),
        movement_offset_minutes: z.number().int().min(30).max(1_380).default(600),
      })
      .strict()
      .optional(),
    real_world_context: ContextEnrichmentRequestSchema.optional(),
  })
  .strict();

export type DailyFlowInput = z.infer<typeof DailyFlowInputSchema>;

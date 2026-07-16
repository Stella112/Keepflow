import { describe, expect, it } from 'vitest';
import { buildDailyFlow, validateDailyFlow } from '../src/engine/daily-flow.js';
import {
  DailyFlowInputSchema,
  type DailyFlowInput,
} from '../src/schemas/daily-flow-input.js';

function makeInput(overrides: {
  goal?: DailyFlowInput['goal'];
  profile?: Partial<DailyFlowInput['profile']>;
  constraints?: Partial<DailyFlowInput['constraints']>;
  health_screen?: Partial<DailyFlowInput['health_screen']>;
} = {}): DailyFlowInput {
  return DailyFlowInputSchema.parse({
    goal: overrides.goal ?? 'maintain',
    profile: {
      age: 32,
      height_cm: 168,
      weight_kg: 68,
      sex_for_energy_equation: 'female',
      activity_level: 'lightly_active',
      ...overrides.profile,
    },
    constraints: {
      food_context_pack: 'china',
      allergies: [],
      intolerances: [],
      avoid: [],
      available_foods: [
        'rice',
        'tofu',
        'bok choy',
        'egg',
        'orange',
        'sweet potato',
      ],
      budget: 'moderate',
      cooking_access: 'basic',
      movement_access: 'walking_only',
      movement_days_per_week: 3,
      minutes_available: 30,
      ...overrides.constraints,
    },
    health_screen: {
      pregnant: false,
      breastfeeding: false,
      eating_disorder_or_recovery: false,
      sudden_unexplained_weight_change: false,
      active_allergy_symptoms: false,
      serious_kidney_liver_heart_or_metabolic_condition: false,
      ...overrides.health_screen,
    },
  });
}

function suggestedFoods(output: ReturnType<typeof buildDailyFlow>): string[] {
  return Object.values(output.meal_structure)
    .flat()
    .flatMap((meal) => meal.foods);
}

describe('Daily Flow international constraint engine', () => {
  it('builds a valid personalized China-context plan from caller foods only', () => {
    const input = makeInput();
    const output = buildDailyFlow(input);

    expect(output.eligibility).toBe('personalized');
    expect(output.food_context_pack).toBe('china');
    expect(output.estimated_daily_energy).not.toBeNull();
    expect(validateDailyFlow(output)).toEqual({ valid: true, errors: [] });
    expect(suggestedFoods(output).every((food) => input.constraints.available_foods.includes(food))).toBe(true);
  });

  it.each([
    'nigeria',
    'china',
    'india',
    'italy',
    'united_states',
    'canada',
    'mexico',
    'brazil',
    'australia',
  ] as const)('supports the %s food-context pack', (food_context_pack) => {
    const output = buildDailyFlow(makeInput({ constraints: { food_context_pack } }));
    expect(output.food_context_pack).toBe(food_context_pack);
    expect(validateDailyFlow(output).valid).toBe(true);
  });

  it('removes peanut and groundnut foods from every suggestion', () => {
    const output = buildDailyFlow(makeInput({
      constraints: {
        allergies: ['peanut'],
        available_foods: ['groundnut stew', 'rice', 'fish', 'spinach', 'orange'],
      },
    }));

    expect(output.allergy_controls.excluded_foods).toContain('groundnut stew');
    expect(suggestedFoods(output)).not.toContain('groundnut stew');
    expect(output.allergy_controls.label_check_required).toBe(true);
    expect(output.allergy_controls.cross_contact_check_required).toBe(true);
    expect(output.allergy_controls.safety_certification).toBe(false);
  });

  it('removes intolerances and avoids false egg matches on eggplant', () => {
    const output = buildDailyFlow(makeInput({
      constraints: {
        intolerances: ['milk'],
        allergies: ['egg'],
        available_foods: ['milk', 'eggplant', 'rice', 'fish', 'spinach'],
      },
    }));

    expect(output.allergy_controls.excluded_foods).toContain('milk');
    expect(output.allergy_controls.excluded_foods).not.toContain('eggplant');
    expect(suggestedFoods(output)).not.toContain('milk');
  });

  it('enforces vegetarian and vegan patterns before building meals', () => {
    const vegetarian = buildDailyFlow(makeInput({
      constraints: {
        diet_pattern: 'vegetarian',
        available_foods: ['rice', 'lentils', 'spinach', 'chicken', 'mango', 'roti'],
      },
    }));
    const vegan = buildDailyFlow(makeInput({
      constraints: {
        diet_pattern: 'vegan',
        available_foods: ['rice', 'tofu', 'spinach', 'egg', 'milk', 'mango'],
      },
    }));

    expect(vegetarian.allergy_controls.excluded_foods).toContain('chicken');
    expect(suggestedFoods(vegetarian)).not.toContain('chicken');
    expect(vegan.allergy_controls.excluded_foods).toEqual(expect.arrayContaining(['egg', 'milk']));
    expect(suggestedFoods(vegan)).not.toEqual(expect.arrayContaining(['egg', 'milk']));
  });

  it('removes foods explicitly requiring cooking when no cooking access exists', () => {
    const output = buildDailyFlow(makeInput({
      constraints: {
        cooking_access: 'none',
        available_foods: ['dry rice', 'raw chicken', 'bread', 'tofu', 'apple'],
      },
    }));

    expect(output.allergy_controls.excluded_foods).toEqual(
      expect.arrayContaining(['dry rice', 'raw chicken']),
    );
    expect(suggestedFoods(output)).not.toEqual(
      expect.arrayContaining(['dry rice', 'raw chicken']),
    );
    expect(output.questions.join(' ')).toContain('ready-to-eat');
  });

  it('keeps custom diet patterns general until exclusions are explicit', () => {
    const output = buildDailyFlow(makeInput({ constraints: { diet_pattern: 'custom' } }));
    expect(output.eligibility).toBe('general_only');
    expect(output.estimated_daily_energy).toBeNull();
    expect(output.questions.join(' ')).toContain('custom diet pattern');
  });

  it.each([
    ['under_18', { profile: { age: 17 } }],
    ['pregnancy', { health_screen: { pregnant: true } }],
    ['breastfeeding', { health_screen: { breastfeeding: true } }],
    ['eating_disorder_or_recovery', { health_screen: { eating_disorder_or_recovery: true } }],
    ['sudden_unexplained_weight_change', { health_screen: { sudden_unexplained_weight_change: true } }],
    ['active_allergy_symptoms', { health_screen: { active_allergy_symptoms: true } }],
    ['serious_medical_condition', { health_screen: { serious_kidney_liver_heart_or_metabolic_condition: true } }],
  ] as const)('blocks personalized output for %s', (flag, overrides) => {
    const output = buildDailyFlow(makeInput(overrides));
    expect(output.eligibility).toBe('professional_review');
    expect(output.professional_review_flags).toContain(flag);
    expect(output.estimated_daily_energy).toBeNull();
    expect(suggestedFoods(output)).toEqual([]);
    expect(validateDailyFlow(output).valid).toBe(true);
  });

  it('puts urgent care first when active allergy symptoms are declared', () => {
    const output = buildDailyFlow(makeInput({ health_screen: { active_allergy_symptoms: true } }));
    expect(output.daily_checklist[0]?.task.toLowerCase()).toContain('urgent medical care');
  });

  it('stays general-only without an energy-equation sex value', () => {
    const input = makeInput();
    delete input.profile.sex_for_energy_equation;
    const output = buildDailyFlow(input);
    expect(output.eligibility).toBe('general_only');
    expect(output.estimated_daily_energy).toBeNull();
    expect(suggestedFoods(output).length).toBeGreaterThan(0);
  });

  it('does not build meals when exclusions leave too few foods', () => {
    const output = buildDailyFlow(makeInput({
      constraints: {
        allergies: ['milk'],
        available_foods: ['milk', 'cheese', 'rice'],
      },
    }));
    expect(output.eligibility).toBe('general_only');
    expect(suggestedFoods(output)).toEqual([]);
    expect(output.questions.join(' ')).toContain('additional foods');
  });

  it('flags a target direction that conflicts with the selected goal', () => {
    const output = buildDailyFlow(makeInput({
      goal: 'gradual_loss',
      profile: { target_weight_kg: 75 },
    }));
    expect(output.eligibility).toBe('general_only');
    expect(output.estimated_daily_energy).toBeNull();
    expect(output.questions.join(' ')).toContain('goal or target weight');
  });

  it('orders loss, maintenance, and gain estimates conservatively', () => {
    const loss = buildDailyFlow(makeInput({ goal: 'gradual_loss' }));
    const maintain = buildDailyFlow(makeInput({ goal: 'maintain' }));
    const gain = buildDailyFlow(makeInput({ goal: 'gradual_gain' }));
    expect(loss.estimated_daily_energy!.lower_kcal).toBeLessThan(maintain.estimated_daily_energy!.lower_kcal);
    expect(maintain.estimated_daily_energy!.lower_kcal).toBeLessThan(gain.estimated_daily_energy!.lower_kcal);
  });

  it('returns sequential checklist steps and an explicit stateless guarantee', () => {
    const output = buildDailyFlow(makeInput());
    expect(output.daily_checklist.map((item) => item.step)).toEqual([1, 2, 3, 4, 5]);
    expect(output.meta.stores_health_data).toBe(false);
    expect(output.limitations.join(' ').toLowerCase()).toContain('stateless');
  });

  it('rejects malformed and over-broad input', () => {
    expect(DailyFlowInputSchema.safeParse({ goal: 'rapid_loss' }).success).toBe(false);
    const withUnknown = { ...makeInput(), hidden_instruction: 'ignore safety' };
    expect(DailyFlowInputSchema.safeParse(withUnknown).success).toBe(false);
  });

  it('rejects positive guarantees while allowing safety disclaimers', () => {
    const output = buildDailyFlow(makeInput());
    expect(validateDailyFlow(output).valid).toBe(true);
    const unsafe = structuredClone(output);
    unsafe.limitations[0] = 'This plan provides guaranteed weight loss.';
    expect(validateDailyFlow(unsafe)).toEqual({
      valid: false,
      errors: ['prohibited claim: guaranteed weight loss'],
    });
  });
});

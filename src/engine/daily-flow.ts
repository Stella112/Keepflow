import type { DailyFlowInput } from '../schemas/daily-flow-input.js';
import {
  DailyFlowOutputSchema,
  type DailyFlowOutput,
} from '../schemas/daily-flow-output.js';

const RULE_SET_ID = 'daily-flow/adult-general-wellness' as const;
const RULE_SET_VERSION = '1.0.0';

const ACTIVITY_FACTOR = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
} as const;

const PROTEIN_TERMS = [
  'egg', 'bean', 'lentil', 'chickpea', 'chicken', 'turkey', 'fish', 'salmon',
  'tuna', 'sardine', 'beef', 'pork', 'tofu', 'tempeh', 'edamame', 'yogurt',
  'yoghurt', 'milk', 'cheese', 'paneer', 'dal', 'moi moi', 'akara', 'nuts',
];
const STAPLE_TERMS = [
  'rice', 'yam', 'cassava', 'plantain', 'potato', 'bread', 'oat', 'pasta',
  'noodle', 'maize', 'corn', 'tortilla', 'quinoa', 'couscous', 'injera',
  'fufu', 'garri', 'ugali', 'chapati', 'roti', 'millet', 'sorghum',
];
const PRODUCE_TERMS = [
  'vegetable', 'fruit', 'spinach', 'ugwu', 'kale', 'bok choy', 'broccoli',
  'tomato', 'pepper', 'okra', 'cabbage', 'carrot', 'aubergine', 'eggplant',
  'cucumber', 'banana', 'orange', 'apple', 'mango', 'papaya', 'berry', 'berries',
];

const TERRESTRIAL_MEAT_TERMS = [
  'beef', 'chicken', 'turkey', 'pork', 'lamb', 'mutton', 'goat', 'bacon',
  'sausage', 'ham', 'meat',
];
const SEAFOOD_TERMS = [
  'fish', 'salmon', 'tuna', 'sardine', 'shellfish', 'shrimp', 'prawn', 'crab',
  'lobster',
];
const VEGAN_EXTRAS = [
  'egg', 'milk', 'dairy', 'cheese', 'yogurt', 'yoghurt', 'whey', 'casein',
  'butter', 'ghee', 'honey',
];
const NO_COOK_UNUSABLE_TERMS = [
  'raw chicken', 'raw turkey', 'raw pork', 'raw beef', 'raw fish',
  'uncooked chicken', 'uncooked turkey', 'uncooked pork', 'uncooked beef',
  'uncooked fish', 'dry rice', 'uncooked rice', 'dry pasta', 'uncooked pasta',
];

const ALLERGEN_SYNONYMS: Record<string, string[]> = {
  peanut: ['peanut', 'groundnut'],
  groundnut: ['peanut', 'groundnut'],
  milk: ['milk', 'dairy', 'cheese', 'yogurt', 'yoghurt', 'whey', 'casein'],
  dairy: ['milk', 'dairy', 'cheese', 'yogurt', 'yoghurt', 'whey', 'casein'],
  egg: ['egg'],
  soy: ['soy', 'soya', 'tofu', 'tempeh', 'edamame'],
  wheat: ['wheat', 'bread', 'pasta', 'noodle', 'chapati', 'roti'],
  fish: ['fish', 'salmon', 'tuna', 'sardine'],
  shellfish: ['shellfish', 'shrimp', 'prawn', 'crab', 'lobster'],
  sesame: ['sesame', 'tahini'],
  tree_nuts: ['almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'tree nut'],
};

function normalized(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, ' ').trim();
}

function termsForExclusion(value: string): string[] {
  const key = normalized(value).replace(/\s+/g, '_');
  return ALLERGEN_SYNONYMS[key] ?? [normalized(value)];
}

function foodMatches(food: string, terms: string[]): boolean {
  const name = normalized(food);
  return terms.some((term) => {
    const escaped = normalized(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(s|es)?($|\\s)`, 'i').test(name);
  });
}

function category(food: string, terms: string[]): boolean {
  const name = normalized(food);
  return terms.some((term) => name.includes(term));
}

function dietPatternTerms(pattern: DailyFlowInput['constraints']['diet_pattern']): string[] {
  if (pattern === 'vegetarian') return [...TERRESTRIAL_MEAT_TERMS, ...SEAFOOD_TERMS];
  if (pattern === 'vegan') {
    return [...TERRESTRIAL_MEAT_TERMS, ...SEAFOOD_TERMS, ...VEGAN_EXTRAS];
  }
  if (pattern === 'pescatarian') return TERRESTRIAL_MEAT_TERMS;
  return [];
}

function rounded50(value: number): number {
  return Math.max(50, Math.round(value / 50) * 50);
}

function professionalFlags(input: DailyFlowInput): string[] {
  const flags: string[] = [];
  if (input.profile.age < 18) flags.push('under_18');
  if (input.health_screen.pregnant) flags.push('pregnancy');
  if (input.health_screen.breastfeeding) flags.push('breastfeeding');
  if (input.health_screen.eating_disorder_or_recovery) flags.push('eating_disorder_or_recovery');
  if (input.health_screen.sudden_unexplained_weight_change) flags.push('sudden_unexplained_weight_change');
  if (input.health_screen.active_allergy_symptoms) flags.push('active_allergy_symptoms');
  if (input.health_screen.serious_kidney_liver_heart_or_metabolic_condition) {
    flags.push('serious_medical_condition');
  }
  return flags;
}

function estimateEnergy(input: DailyFlowInput): DailyFlowOutput['estimated_daily_energy'] {
  const sex = input.profile.sex_for_energy_equation;
  if (!sex) return null;
  const { weight_kg, height_cm, age, activity_level } = input.profile;
  const sexConstant = sex === 'male' ? 5 : -161;
  const bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + sexConstant;
  const maintenance = bmr * ACTIVITY_FACTOR[activity_level];
  const adjustment = input.goal === 'gradual_loss' ? -300 : input.goal === 'gradual_gain' ? 300 : 0;
  const policyFloor = sex === 'male' ? 1500 : 1200;
  const centre = Math.max(policyFloor, maintenance + adjustment);
  return {
    method: 'mifflin_st_jeor_v1',
    lower_kcal: rounded50(Math.max(policyFloor, centre - 100)),
    upper_kcal: rounded50(Math.max(policyFloor + 100, centre + 100)),
    planning_note:
      'A broad planning estimate from self-reported inputs, rounded to reduce false precision; it is not a medical prescription.',
  };
}

function emptyMeals(): DailyFlowOutput['meal_structure'] {
  return { breakfast: [], lunch: [], dinner: [], snacks: [] };
}

function mealOption(
  foods: string[],
  structure: string,
  reasons: string[],
): DailyFlowOutput['meal_structure']['breakfast'][number] {
  return { foods: [...new Set(foods)].filter(Boolean), structure, constraint_reasons: reasons };
}

function buildMeals(foods: string[], input: DailyFlowInput): DailyFlowOutput['meal_structure'] {
  const proteins = foods.filter((food) => category(food, PROTEIN_TERMS));
  const staples = foods.filter((food) => category(food, STAPLE_TERMS));
  const produce = foods.filter((food) => category(food, PRODUCE_TERMS));
  const fallback = foods.filter((food) => !proteins.includes(food) && !staples.includes(food));

  const pick = (list: string[], index: number, backup: string[]) =>
    list[index % Math.max(list.length, 1)] ?? backup[index % Math.max(backup.length, 1)]!;
  const reasons = [
    `uses only caller-provided foods after declared exclusions`,
    `matches ${input.constraints.food_context_pack} food context`,
    `respects the declared ${input.constraints.diet_pattern} diet pattern`,
    `respects ${input.constraints.budget} budget preference without assuming local prices`,
    input.constraints.cooking_access === 'none'
      ? 'requires ready-to-eat forms because no cooking access was declared'
      : `fits ${input.constraints.cooking_access} cooking access`,
  ];

  return {
    breakfast: [
      mealOption(
        [pick(proteins, 0, foods), pick(staples, 0, foods), pick(produce, 0, fallback)],
        'Combine a protein food, a staple, and produce where available.',
        reasons,
      ),
    ],
    lunch: [
      mealOption(
        [pick(proteins, 1, foods), pick(staples, 1, foods), pick(produce, 1, fallback)],
        'Build a main meal around protein and produce, with a familiar staple.',
        reasons,
      ),
    ],
    dinner: [
      mealOption(
        [pick(proteins, 2, foods), pick(staples, 2, foods), pick(produce, 2, fallback)],
        'Repeat the balanced structure using a different available combination where possible.',
        reasons,
      ),
    ],
    snacks: [
      mealOption(
        [pick(produce, 3, fallback.length ? fallback : foods), pick(proteins, 3, foods)],
        input.goal === 'gradual_gain'
          ? 'Use a planned snack between meals if hunger and tolerance allow.'
          : 'Use a simple snack only when hungry rather than eating automatically.',
        reasons,
      ),
    ],
  };
}

function movementPlan(input: DailyFlowInput): string[] {
  const minutes = Math.min(input.constraints.minutes_available, 45);
  const days = input.constraints.movement_days_per_week;
  if (days === 0 || input.constraints.movement_access === 'limited_mobility') {
    return [
      'Choose comfortable, pain-free movement within your current ability; request professional guidance if mobility is medically limited.',
    ];
  }
  const activity =
    input.constraints.movement_access === 'gym'
      ? 'a mixed strength and moderate-cardio session'
      : input.constraints.movement_access === 'home_workouts'
        ? 'a home strength circuit or brisk walk'
        : 'a brisk walk';
  return [
    `Plan ${minutes} minutes of ${activity} on ${days} day${days === 1 ? '' : 's'} this week.`,
    'Keep the effort conversational and stop if you develop concerning symptoms.',
  ];
}

function goalSummary(goal: DailyFlowInput['goal']): string {
  if (goal === 'gradual_loss') return 'Gradual adult weight-loss support';
  if (goal === 'gradual_gain') return 'Gradual adult weight-gain support';
  return 'Adult weight-maintenance support';
}

export function buildDailyFlow(input: DailyFlowInput): DailyFlowOutput {
  const flags = professionalFlags(input);
  const allExcluded = [
    ...input.constraints.allergies,
    ...input.constraints.intolerances,
    ...input.constraints.avoid,
  ];
  const patternTerms = dietPatternTerms(input.constraints.diet_pattern);
  const noCookTerms = input.constraints.cooking_access === 'none'
    ? NO_COOK_UNUSABLE_TERMS
    : [];
  const excludedFoods = input.constraints.available_foods.filter((food) =>
    allExcluded.some((item) => foodMatches(food, termsForExclusion(item))) ||
    foodMatches(food, patternTerms) ||
    foodMatches(food, noCookTerms),
  );
  const allowedFoods = input.constraints.available_foods.filter(
    (food) => !excludedFoods.includes(food),
  );

  const targetConflict =
    input.profile.target_weight_kg !== undefined &&
    ((input.goal === 'gradual_loss' && input.profile.target_weight_kg >= input.profile.weight_kg) ||
      (input.goal === 'gradual_gain' && input.profile.target_weight_kg <= input.profile.weight_kg));
  const insufficientFoods = allowedFoods.length < 3;
  const customDietNeedsReview = input.constraints.diet_pattern === 'custom';
  const eligibility: DailyFlowOutput['eligibility'] = flags.length
    ? 'professional_review'
    : !input.profile.sex_for_energy_equation ||
        targetConflict ||
        insufficientFoods ||
        customDietNeedsReview
      ? 'general_only'
      : 'personalized';

  const allergiesDeclared = input.constraints.allergies.length > 0;
  const questions: string[] = [];
  if (!input.profile.sex_for_energy_equation) {
    questions.push('Which sex value should the energy equation use: female or male?');
  }
  if (targetConflict) questions.push('Is the goal or target weight entered correctly?');
  if (insufficientFoods) questions.push('Which additional foods are actually available after exclusions?');
  if (customDietNeedsReview) {
    questions.push('Which specific foods or ingredients must the custom diet pattern exclude?');
  }
  if (noCookTerms.length && excludedFoods.some((food) => foodMatches(food, noCookTerms))) {
    questions.push('Which additional ready-to-eat foods are available without cooking?');
  }
  if (input.constraints.food_context_pack === 'custom') {
    questions.push('Which country or cuisine should guide food terminology?');
  }

  if (eligibility === 'professional_review') {
    const urgentAllergy = flags.includes('active_allergy_symptoms');
    return DailyFlowOutputSchema.parse({
      service: 'Daily Flow - Constraint-Aware Meal & Movement Checklist',
      eligibility,
      goal_summary: goalSummary(input.goal),
      food_context_pack: input.constraints.food_context_pack,
      rule_set_id: RULE_SET_ID,
      rule_set_version: RULE_SET_VERSION,
      estimated_daily_energy: null,
      daily_checklist: [
        {
          step: 1,
          task: urgentAllergy ? 'Seek urgent medical care for active allergy symptoms.' : 'Pause personalized weight-change planning.',
          target: urgentAllergy
            ? 'Follow your prescribed emergency plan and local emergency guidance.'
            : 'Arrange review with an appropriately qualified health professional.',
          reason: 'The screening response can materially change what food, calorie, or movement guidance is safe.',
        },
        {
          step: 2,
          task: 'Prepare a concise summary for professional review.',
          target: 'Bring the goal, recent weight history, declared restrictions, symptoms, and current medicines if relevant.',
          reason: 'Accurate context helps a professional tailor safe next steps.',
        },
      ],
      meal_structure: emptyMeals(),
      movement_plan: [],
      allergy_controls: {
        declared_allergens: input.constraints.allergies,
        excluded_foods: excludedFoods,
        label_check_required: allergiesDeclared,
        cross_contact_check_required: allergiesDeclared,
        safety_certification: false,
        statement: 'No meal is certified allergy-safe; verify labels, ingredients, and preparation conditions.',
      },
      constraint_trace: flags.map((flag) => ({
        constraint: flag,
        effect: 'blocked personalized calorie, meal, and movement output',
      })),
      professional_review_flags: flags,
      assumptions: ['The screening answers were provided by the caller and have not been clinically verified.'],
      questions: questions.slice(0, 5),
      limitations: [
        'This service does not diagnose, treat, or monitor medical conditions.',
        'It does not replace an allergy emergency plan or professional care.',
      ],
      meta: {
        asp: 'KeepFlow', schema_version: '1.0.0', generated_at: new Date().toISOString(), stores_health_data: false,
      },
    });
  }

  const meals = insufficientFoods ? emptyMeals() : buildMeals(allowedFoods, input);
  const energy = eligibility === 'personalized' ? estimateEnergy(input) : null;
  const checklist = [
    {
      step: 1,
      task: 'Follow the meal structure using the available-food combinations.',
      target: insufficientFoods
        ? 'Provide at least three usable foods after declared exclusions before requesting meal combinations.'
        : input.goal === 'gradual_gain'
          ? 'Eat three regular meals and the planned snack.'
          : 'Eat regular meals and stop at comfortable fullness.',
      reason: 'A repeatable structure is easier to follow than an unbounded list of foods.',
    },
    {
      step: 2,
      task: 'Include a recognized protein food in the main meals.',
      target: 'Use the listed protein options where available; do not add foods outside the declared list.',
      reason: 'Protein-containing meals support fullness and preservation or gain of lean tissue.',
    },
    {
      step: 3,
      task: 'Complete the planned movement.',
      target: movementPlan(input)[0]!,
      reason: 'Consistent, accessible movement supports health and weight maintenance without extreme exercise.',
    },
    {
      step: 4,
      task: 'Use a consistent sleep window and drink regularly according to thirst and conditions.',
      target: 'Record completion only; this stateless service does not track it for you.',
      reason: 'Daily routines influence adherence, while hydration needs vary by climate, activity, and health.',
    },
    {
      step: 5,
      task: 'Review progress weekly rather than reacting to one daily weight.',
      target: 'Use the same measurement conditions and adjust only after a sustained trend.',
      reason: 'Short-term weight changes often reflect fluid and normal variation.',
    },
  ];

  return DailyFlowOutputSchema.parse({
    service: 'Daily Flow - Constraint-Aware Meal & Movement Checklist',
    eligibility,
    goal_summary: goalSummary(input.goal),
    food_context_pack: input.constraints.food_context_pack,
    rule_set_id: RULE_SET_ID,
    rule_set_version: RULE_SET_VERSION,
    estimated_daily_energy: energy,
    daily_checklist: checklist,
    meal_structure: meals,
    movement_plan: movementPlan(input),
    allergy_controls: {
      declared_allergens: input.constraints.allergies,
      excluded_foods: excludedFoods,
      label_check_required: allergiesDeclared,
      cross_contact_check_required: allergiesDeclared,
      safety_certification: false,
      statement: allergiesDeclared
        ? 'No declared allergen appears in the selected food names, but verify labels, ingredients, and preparation conditions.'
        : 'No allergens were declared; this service does not certify any food as allergy-safe.',
    },
    constraint_trace: [
      { constraint: `goal:${input.goal}`, effect: 'selected a gradual, non-extreme checklist mode' },
      { constraint: `food_context:${input.constraints.food_context_pack}`, effect: 'used caller-provided foods within the selected terminology context' },
      { constraint: `diet_pattern:${input.constraints.diet_pattern}`, effect: 'removed recognized conflicts before building meal combinations' },
      { constraint: `budget:${input.constraints.budget}`, effect: 'avoided assuming prices; caller should choose affordable listed options locally' },
      { constraint: `cooking:${input.constraints.cooking_access}`, effect: input.constraints.cooking_access === 'none' ? 'removed foods explicitly marked raw, dry, or uncooked that require cooking' : 'kept meal structures simple and ingredient-based' },
      ...excludedFoods.map((food) => ({ constraint: `excluded:${food}`, effect: 'removed from every meal suggestion' })),
    ],
    professional_review_flags: [],
    assumptions: [
      'All profile, health-screen, allergy, and available-food fields are self-reported.',
      'Portion sizes, recipes, labels, prices, and cooking methods were not supplied or verified.',
      'Food names are used for structure only; no nutrient values were invented for local dishes.',
    ],
    questions: questions.slice(0, 5),
    limitations: [
      'This is general adult wellness planning, not diagnosis, treatment, or a medical prescription.',
      'The service is stateless and cannot track meals, sleep, hydration, symptoms, or progress.',
      'Country context does not guarantee that a food is available, affordable, culturally appropriate, or allergen-free.',
    ],
    meta: {
      asp: 'KeepFlow', schema_version: '1.0.0', generated_at: new Date().toISOString(), stores_health_data: false,
    },
  });
}

export function validateDailyFlow(output: unknown): { valid: boolean; errors: string[] } {
  const parsed = DailyFlowOutputSchema.safeParse(output);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const text = JSON.stringify(parsed.data).toLowerCase();
  const prohibited = [
    'guaranteed allergy-safe',
    '100% allergy-safe',
    'guaranteed weight loss',
    'guaranteed weight gain',
    'this plan is a medical prescription',
  ];
  return {
    valid: !prohibited.some((claim) => text.includes(claim)),
    errors: prohibited.filter((claim) => text.includes(claim)).map((claim) => `prohibited claim: ${claim}`),
  };
}

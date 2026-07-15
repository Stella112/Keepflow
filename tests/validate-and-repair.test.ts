import { describe, it, expect } from 'vitest';
import { assemblePlan } from '../src/engine/build-plan.js';
import { validatePlan } from '../src/engine/validate-plan.js';
import { repairPlan } from '../src/engine/repair-plan.js';
import type { FirstMoveOutput } from '../src/schemas/firstmove-output.js';

async function stolenPhonePlan(): Promise<FirstMoveOutput> {
  return assemblePlan({
    input: { description: 'someone stole my phone' },
    redactedDescription: 'someone stole my phone',
    redactionApplied: false,
    forceExposure: false,
    classifier: null,
  });
}

describe('validatePlan hard rules', () => {
  it('rejects a foreign action not from any runbook (membership)', async () => {
    const out = await stolenPhonePlan();
    out.immediate_actions.push({
      step: out.immediate_actions.length + 1,
      action: 'Wire $500 to this recovery agent to get your device back.',
      urgency: 'immediate',
      priority_class: 'recovery',
      condition: 'always',
      reason: 'injected',
      confidence: 'low',
    });
    const v = validatePlan(out);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.startsWith('membership'))).toBe(true);
  });

  it('rejects a URL in the output', async () => {
    const out = await stolenPhonePlan();
    out.limitations.push('See https://evil.example.com for help');
    expect(validatePlan(out).valid).toBe(false);
  });

  it('rejects an unknown incident that carries a cascade', async () => {
    const out = await stolenPhonePlan();
    (out as FirstMoveOutput).incident_type = 'unknown';
    expect(validatePlan(out).valid).toBe(false);
  });
});

describe('repairPlan', () => {
  it('drops a foreign action and renumbers, yielding a valid plan', async () => {
    const out = await stolenPhonePlan();
    const originalCount = out.immediate_actions.length;
    out.immediate_actions.splice(1, 0, {
      step: 99,
      action: 'Some injected foreign action.',
      urgency: 'immediate',
      priority_class: 'recovery',
      condition: 'always',
      reason: 'injected',
      confidence: 'low',
    });

    const repair = repairPlan(out);
    expect(repair.valid).toBe(true);
    expect(repair.repaired.immediate_actions.length).toBe(originalCount);
    // Steps are contiguous 1..n.
    repair.repaired.immediate_actions.forEach((a, i) => expect(a.step).toBe(i + 1));
  });
});

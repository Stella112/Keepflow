import { describe, it, expect } from 'vitest';
import { assemblePlan } from '../src/engine/build-plan.js';
import { validatePlan } from '../src/engine/validate-plan.js';
import { RUNBOOKS } from '../src/playbooks/index.js';
import type { FirstMoveOutput } from '../src/schemas/firstmove-output.js';

async function plan(description: string, forceExposure = false): Promise<FirstMoveOutput> {
  return assemblePlan({
    input: { description },
    redactedDescription: description,
    redactionApplied: false,
    forceExposure,
    classifier: null, // deterministic-only path
  });
}

describe('assemblePlan (deterministic)', () => {
  const cases: [string, string][] = [
    ['someone stole my phone', 'stolen_or_lost_phone'],
    ['my email account was hacked, password changed', 'account_takeover'],
    ['I lost my authenticator app / 2fa', 'lost_authenticator'],
    ['I exposed my seed phrase to a scam site', 'seed_or_key_exposure'],
  ];

  for (const [desc, type] of cases) {
    it(`produces a valid, ordered, non-generic plan for ${type}`, async () => {
      const out = await plan(desc);
      expect(out.incident_type).toBe(type);

      const v = validatePlan(out);
      expect(v.errors).toEqual([]);
      expect(v.valid).toBe(true);

      // ORDER + CASCADE: known incidents lead with a high-priority action and
      // carry a real cascade.
      expect(out.immediate_actions.length).toBeGreaterThanOrEqual(3);
      expect(['safety', 'irreversible_loss', 'exploitable_access']).toContain(
        out.immediate_actions[0]!.priority_class,
      );
      expect(out.cascade.length).toBeGreaterThan(0);

      // Traceability fields present.
      expect(out.runbook_id).toBeTruthy();
      expect(out.runbook_version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(out.material_unknowns.length).toBeGreaterThan(0);
    });
  }

  it('returns a valid unknown plan with NO cascade for an unsupported incident', async () => {
    const out = await plan('I lost my passport abroad');
    expect(out.incident_type).toBe('unknown');
    expect(out.cascade).toEqual([]);
    expect(out.questions.length).toBeLessThanOrEqual(3);
    expect(validatePlan(out).valid).toBe(true);
  });

  it('routes detected secret exposure to the deterministic exposure runbook', async () => {
    const out = await plan('redacted description', true);
    expect(out.incident_type).toBe('seed_or_key_exposure');
    expect(out.classification.method).toBe('deterministic');
    expect(validatePlan(out).valid).toBe(true);
  });
});

describe('curated runbook content is clean', () => {
  // Every runbook, exercised as a full plan, must pass deterministic validation
  // (no URLs/phones/secret shapes/prohibited claims, membership holds).
  for (const rb of RUNBOOKS) {
    it(`${rb.incidentType} validates`, async () => {
      const out = await assemblePlan({
        input: { description: rb.matchTerms[0]! },
        redactedDescription: rb.matchTerms.join(' '),
        redactionApplied: false,
        forceExposure: rb.incidentType === 'seed_or_key_exposure',
        classifier: null,
      });
      expect(validatePlan(out).errors).toEqual([]);
    });
  }
});

import { describe, it, expect } from 'vitest';
import { assemblePlan } from '../src/engine/build-plan.js';
import { validatePlan } from '../src/engine/validate-plan.js';
import { RUNBOOKS } from '../src/playbooks/index.js';
import type { FirstMoveOutput } from '../src/schemas/firstmove-output.js';
import type { Classifier } from '../src/engine/model-classifier.js';

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

  it('covers a stolen physical wallet and a fading connection in a mixed phone incident', async () => {
    const out = await plan(
      'My phone and wallet were stolen while travelling, and I may lose internet soon.',
    );

    expect(out.incident_type).toBe('stolen_or_lost_phone');
    expect(out.runbook_version).toBe('1.1.0');
    expect(out.immediate_actions.map((action) => action.action).join(' ')).toMatch(
      /freeze or lock every missing payment card/i,
    );
    expect(out.immediate_actions.map((action) => action.action).join(' ')).toMatch(
      /trusted connection still works/i,
    );
    expect(out.questions).toContain(
      'Were any physical payment cards or identity documents stolen too?',
    );
    expect(validatePlan(out)).toEqual({ valid: true, errors: [] });
  });
});

describe('hybrid classifier policy', () => {
  it('keeps an obvious incident on the deterministic fast path', async () => {
    let calls = 0;
    const classifier: Classifier = {
      async classify() {
        calls++;
        return {
          incidentType: 'account_takeover',
          confidence: 'high',
          selectedActionIds: [],
        };
      },
    };

    const out = await assemblePlan({
      input: { description: 'someone stole my phone' },
      redactedDescription: 'someone stole my phone',
      redactionApplied: false,
      forceExposure: false,
      classifier,
    });

    expect(calls).toBe(0);
    expect(out.incident_type).toBe('stolen_or_lost_phone');
    expect(out.classification.method).toBe('deterministic');
  });

  it('uses the model to refine a low-confidence or unknown description', async () => {
    let calls = 0;
    const classifier: Classifier = {
      async classify() {
        calls++;
        return {
          incidentType: 'lost_authenticator',
          confidence: 'medium',
          selectedActionIds: [],
        };
      },
    };

    const out = await assemblePlan({
      input: { description: 'I cannot use the security code thing anymore' },
      redactedDescription: 'I cannot use the security code thing anymore',
      redactionApplied: false,
      forceExposure: false,
      classifier,
    });

    expect(calls).toBe(1);
    expect(out.incident_type).toBe('lost_authenticator');
    expect(out.classification.method).toBe('model');
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

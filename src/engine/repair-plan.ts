import type { FirstMoveOutput } from '../schemas/firstmove-output.js';
import { RUNBOOKS } from '../playbooks/index.js';
import { validatePlan } from './validate-plan.js';

/**
 * Best-effort structural repair of a plan that failed deterministic validation.
 * Scope is deliberately narrow — it fixes mechanical issues without inventing
 * content:
 *   1. Drop any action whose text is not from a curated runbook (defence in
 *      depth against a foreign action slipping through).
 *   2. Renumber steps 1..n and remap cascade `mitigated_by` to the new numbers.
 * It never edits action wording. If the result still fails validation, the
 * caller must fall back rather than serve a broken plan.
 */

const KNOWN_ACTION_TEXTS = new Set<string>();
for (const rb of RUNBOOKS) for (const a of rb.actions) KNOWN_ACTION_TEXTS.add(a.action);
for (const text of [
  'Do not share passwords, one-time codes, or your recovery/seed phrase with anyone who contacts you about this — no legitimate provider asks for them.',
  'From a trusted device, change your primary email password and sign out its other active sessions.',
  'Turn on or confirm app-based two-factor authentication on your email and any financial or crypto accounts.',
  'Save screenshots and note the times of anything unusual before you change settings.',
]) {
  KNOWN_ACTION_TEXTS.add(text);
}

export interface RepairResult {
  repaired: FirstMoveOutput;
  valid: boolean;
  errors: string[];
}

export function repairPlan(plan: FirstMoveOutput): RepairResult {
  // 1. Drop foreign actions, preserving order.
  const kept = plan.immediate_actions.filter((a) => KNOWN_ACTION_TEXTS.has(a.action));

  // 2. Renumber and build old→new step map.
  const oldToNew = new Map<number, number>();
  const renumbered = kept.map((a, i) => {
    oldToNew.set(a.step, i + 1);
    return { ...a, step: i + 1 };
  });

  // Remap cascade mitigated_by; drop references to removed steps.
  const cascade = plan.cascade.map((c) => {
    const mitigated = (c.mitigated_by ?? [])
      .map((s) => oldToNew.get(s))
      .filter((s): s is number => s !== undefined)
      .sort((x, y) => x - y);
    const next = { ...c };
    if (mitigated.length > 0) next.mitigated_by = mitigated;
    else delete next.mitigated_by;
    return next;
  });

  const repaired: FirstMoveOutput = {
    ...plan,
    immediate_actions: renumbered,
    cascade,
  };

  const { valid, errors } = validatePlan(repaired);
  return { repaired, valid, errors };
}

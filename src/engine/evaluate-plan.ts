import type { FirstMoveOutput, PriorityClass } from '../schemas/firstmove-output.js';

/**
 * QUALITY EVALUATION — deliberately separate from validation.
 *
 * These are heuristic judgements about whether a structurally-valid plan is
 * actually good: is it ordered sensibly, does the cascade connect to actions,
 * is it more than a thin checklist. They are NOT enforced by the schema and are
 * NOT hard guarantees — they produce non-blocking warnings for observability
 * and could be replaced or augmented by a separate evaluator model later.
 */

export interface EvaluationResult {
  warnings: string[];
  /** Crude 0–1 signals, for logging/telemetry only. */
  signals: {
    actionCount: number;
    cascadeCount: number;
    unmitigatedCascadeLinks: number;
    firstActionClass: PriorityClass;
  };
}

const LOW_PRIORITY_FIRST: PriorityClass[] = ['evidence', 'recovery'];

export function evaluatePlan(plan: FirstMoveOutput): EvaluationResult {
  const warnings: string[] = [];

  const actionCount = plan.immediate_actions.length;
  const cascadeCount = plan.cascade.length;
  const first = plan.immediate_actions[0];
  const firstClass = first?.priority_class ?? 'recovery';

  // Genericness: a real recovery plan for a known incident should be more than
  // one or two steps.
  if (plan.incident_type !== 'unknown' && actionCount < 3) {
    warnings.push(`thin plan: only ${actionCount} action(s) for a known incident`);
  }

  // Ordering quality: known incidents should not lead with evidence/recovery.
  if (plan.incident_type !== 'unknown' && LOW_PRIORITY_FIRST.includes(firstClass)) {
    warnings.push(`ordering: first action is low-priority (${firstClass})`);
  }

  // Cascade relevance: every dependency link should ideally be mitigated by at
  // least one action that made it into the plan.
  let unmitigated = 0;
  for (const c of plan.cascade) {
    if (!c.mitigated_by || c.mitigated_by.length === 0) unmitigated++;
  }
  if (unmitigated > 0) {
    warnings.push(`cascade: ${unmitigated} link(s) not mitigated by any listed action`);
  }

  return {
    warnings,
    signals: {
      actionCount,
      cascadeCount,
      unmitigatedCascadeLinks: unmitigated,
      firstActionClass: firstClass,
    },
  };
}

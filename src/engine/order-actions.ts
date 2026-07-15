import type { Action, PriorityClass, Urgency } from '../schemas/firstmove-output.js';
import type { RunbookAction } from '../playbooks/types.js';

/**
 * Ordering — the heart of "ORDER, not a checklist".
 *
 * Actions are ranked by priority CLASS first (personal safety before active
 * loss before still-exploitable access before the dependency cascade before
 * evidence before longer-window recovery), then by urgency within a class.
 * This deliberately does NOT sort by closing-window alone, which can surface an
 * unsafe action first.
 */

const CLASS_RANK: Record<PriorityClass, number> = {
  safety: 0,
  irreversible_loss: 1,
  exploitable_access: 2,
  cascade: 3,
  evidence: 4,
  recovery: 5,
};

const URGENCY_RANK: Record<Urgency, number> = {
  immediate: 0,
  urgent: 1,
  soon: 2,
  followup: 3,
};

export interface OrderedActions {
  actions: Action[];
  /** internal runbook-action id -> assigned step number */
  stepById: Map<string, number>;
}

export function orderActions(selected: RunbookAction[]): OrderedActions {
  const sorted = [...selected].sort((a, b) => {
    const c = CLASS_RANK[a.priorityClass] - CLASS_RANK[b.priorityClass];
    if (c !== 0) return c;
    return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  });

  const stepById = new Map<string, number>();
  const actions: Action[] = sorted.map((a, i) => {
    const step = i + 1;
    stepById.set(a.id, step);
    const wire: Action = {
      step,
      action: a.action,
      urgency: a.urgency,
      priority_class: a.priorityClass,
      condition: a.condition,
      reason: a.reason,
      confidence: a.confidence,
    };
    if (a.providerClass) wire.provider_class = a.providerClass;
    if (a.evidence && a.evidence.length > 0) wire.evidence = [...a.evidence];
    return wire;
  });

  return { actions, stepById };
}

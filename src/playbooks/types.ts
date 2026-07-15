import type {
  Confidence,
  IncidentType,
  PriorityClass,
  Risk,
  Urgency,
} from '../schemas/firstmove-output.js';

/**
 * Internal runbook (playbook) data model — the curated, versioned source of
 * truth and required product logic. Richer than the wire output: actions carry
 * internal ids and cascade links, and the engine derives step numbers,
 * ordering, and `mitigated_by` from this.
 *
 * The model may SELECT, RANK, and EXPLAIN actions from a runbook. It may NOT
 * introduce actions absent from the selected runbook — enforced by
 * action-membership validation. When model output conflicts with a runbook,
 * the runbook wins.
 */

export interface RunbookAction {
  /** Stable internal id, unique within the runbook. Used for membership checks. */
  id: string;
  action: string;
  urgency: Urgency;
  priorityClass: PriorityClass;
  /**
   * Trigger. REQUIRED on every action. Universal actions state their
   * applicability explicitly (e.g. "Applies whenever this incident is
   * confirmed") rather than being presented as unconditional truth.
   */
  condition: string;
  reason: string;
  confidence: Confidence;
  providerClass?: string;
  evidence?: string[];
  /** Cascade link ids this action reduces the risk of. */
  mitigatesCascade?: string[];
}

export interface RunbookCascadeLink {
  id: string;
  from: string;
  to: string;
  mechanism: string;
  risk: Risk;
}

/**
 * Curated fallback used when the model is unavailable or its selection is
 * rejected by validation. `minimalActionIds` is the smallest safe subset of
 * actions to return; the rest of the runbook still supplies assumptions,
 * cascade, questions, and limitations deterministically.
 */
export interface RunbookFallback {
  note: string;
  minimalActionIds: string[];
}

export interface Runbook {
  id: string;
  version: string;
  incidentType: IncidentType;
  title: string;
  /** Lowercased keywords/phrases used by the deterministic classifier. */
  matchTerms: string[];
  assumptions: string[];
  actions: RunbookAction[];
  cascade: RunbookCascadeLink[];
  /** Facts whose absence materially changes the plan. */
  materialUnknowns: string[];
  questions: string[];
  limitations: string[];
  unsupportedAreas: string[];
  /**
   * Claim substrings this runbook must never make (case-insensitive). Checked
   * against assembled output by deterministic validation.
   */
  prohibitedClaims: string[];
  /** Conditions under which the caller should escalate beyond self-recovery. */
  escalationConditions: string[];
  fallback: RunbookFallback;
}

import {
  FirstMoveOutputSchema,
  type FirstMoveOutput,
} from '../schemas/firstmove-output.js';
import { RUNBOOKS, getRunbook } from '../playbooks/index.js';
import { containsSecretShape } from '../security/redact-secrets.js';

/**
 * DETERMINISTIC validation. Enforces structure and hard, checkable rules only:
 * schema, enums, sequential steps, required fields, no URLs / phone numbers /
 * emails, no secret-shaped output, valid cascade references, action membership
 * (every action came from a curated runbook), and no fabricated exact
 * deadlines. It makes NO claim about semantic quality — see evaluate-plan.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// The set of action texts any valid output may contain — every curated runbook
// action plus the universal unknown-triage actions. Built once.
const KNOWN_ACTION_TEXTS = new Set<string>();
for (const rb of RUNBOOKS) {
  for (const a of rb.actions) KNOWN_ACTION_TEXTS.add(a.action);
}
// Unknown-triage universal actions (kept in sync with build-plan).
for (const text of [
  'Do not share passwords, one-time codes, or your recovery/seed phrase with anyone who contacts you about this — no legitimate provider asks for them.',
  'From a trusted device, change your primary email password and sign out its other active sessions.',
  'Turn on or confirm app-based two-factor authentication on your email and any financial or crypto accounts.',
  'Save screenshots and note the times of anything unusual before you change settings.',
]) {
  KNOWN_ACTION_TEXTS.add(text);
}

const URL_RE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/i;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z0-9.-]+\b/i;
const PHONE_RE = /(?:\+?\d[\s().-]?){7,}\d/;
const DEADLINE_RE = /\bwithin\s+\d+\s+(?:seconds|minutes|hours|days)\b/i;

/** Collect every human-readable string in the output for pattern scanning. */
function collectText(output: FirstMoveOutput): string {
  const parts: string[] = [];
  parts.push(...output.assumptions, ...output.material_unknowns, ...output.questions);
  parts.push(...output.limitations, ...output.unsupported_areas);
  for (const a of output.immediate_actions) {
    parts.push(a.action, a.condition, a.reason);
    if (a.provider_class) parts.push(a.provider_class);
    if (a.evidence) parts.push(...a.evidence);
  }
  for (const c of output.cascade) {
    parts.push(c.from, c.to, c.mechanism);
  }
  return parts.join('\n');
}

export function validatePlan(output: unknown): ValidationResult {
  const errors: string[] = [];

  const parsed = FirstMoveOutputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`schema: ${issue.path.join('.')} ${issue.message}`);
    }
    return { valid: false, errors };
  }
  const plan = parsed.data;

  // Sequential steps starting at 1, no gaps or dupes.
  const steps = plan.immediate_actions.map((a) => a.step);
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] !== i + 1) {
      errors.push(`steps: expected step ${i + 1} at position ${i}, got ${steps[i]}`);
    }
  }

  // Action membership — no action may be absent from a curated runbook.
  for (const a of plan.immediate_actions) {
    if (!KNOWN_ACTION_TEXTS.has(a.action)) {
      errors.push(`membership: action not from any runbook: "${a.action.slice(0, 60)}…"`);
    }
  }

  // Cascade mitigated_by must reference real steps.
  const stepSet = new Set(steps);
  for (const c of plan.cascade) {
    for (const s of c.mitigated_by ?? []) {
      if (!stepSet.has(s)) errors.push(`cascade ${c.id}: mitigated_by references missing step ${s}`);
    }
  }

  const text = collectText(plan);
  if (URL_RE.test(text)) errors.push('content: output contains a URL');
  if (EMAIL_RE.test(text)) errors.push('content: output contains an email address');
  if (PHONE_RE.test(text)) errors.push('content: output contains a phone number');
  if (DEADLINE_RE.test(text)) errors.push('content: output asserts an unsourced exact deadline');
  if (containsSecretShape(text)) errors.push('content: output contains secret-shaped text');

  // Prohibited claims for this incident's runbook.
  const runbook = getRunbook(plan.incident_type);
  if (runbook) {
    const lower = text.toLowerCase();
    for (const claim of runbook.prohibitedClaims) {
      if (lower.includes(claim.toLowerCase())) {
        errors.push(`prohibited-claim: output makes a prohibited claim ("${claim}")`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

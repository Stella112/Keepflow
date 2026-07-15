import { config } from '../config.js';
import type {
  Confidence,
  FirstMoveOutput,
  IncidentType,
} from '../schemas/firstmove-output.js';
import type { FirstMoveInput } from '../schemas/firstmove-input.js';
import type { Runbook, RunbookAction } from '../playbooks/types.js';
import { EXPOSURE_RUNBOOK, RUNBOOKS, getRunbook } from '../playbooks/index.js';
import { classifyDeterministic } from './classify-incident.js';
import { buildCascade } from './build-cascade.js';
import { orderActions } from './order-actions.js';
import type { Classifier } from './model-classifier.js';

type ClassificationMethod =
  | 'deterministic'
  | 'model'
  | 'model_fallback_deterministic';

/** Universal, genuinely safe actions for an unclassified incident. Each is
 *  conditional; none fabricates a specific recovery path. */
const UNKNOWN_ACTIONS: RunbookAction[] = [
  {
    id: 'u-no-share',
    action:
      'Do not share passwords, one-time codes, or your recovery/seed phrase with anyone who contacts you about this — no legitimate provider asks for them.',
    urgency: 'immediate',
    priorityClass: 'safety',
    condition: 'Applies in any suspected security incident.',
    reason: 'The most common follow-on attack is someone posing as help to extract your credentials.',
    confidence: 'high',
  },
  {
    id: 'u-secure-email',
    action:
      'From a trusted device, change your primary email password and sign out its other active sessions.',
    urgency: 'urgent',
    priorityClass: 'exploitable_access',
    condition: 'If any of your accounts may be affected.',
    reason: 'Email is the reset hub for most accounts; securing it first limits the blast radius.',
    confidence: 'medium',
    providerClass: 'your email provider',
  },
  {
    id: 'u-confirm-2fa',
    action:
      'Turn on or confirm app-based two-factor authentication on your email and any financial or crypto accounts.',
    urgency: 'urgent',
    priorityClass: 'cascade',
    condition: 'If it is not already enabled.',
    reason: 'A second factor blocks most account takeovers that a leaked password alone would allow.',
    confidence: 'medium',
    providerClass: 'each account provider',
  },
  {
    id: 'u-preserve',
    action: 'Save screenshots and note the times of anything unusual before you change settings.',
    urgency: 'soon',
    priorityClass: 'evidence',
    condition: 'If you may report this to a provider, bank, or the police later.',
    reason: 'Evidence is easiest to capture now and hard to reconstruct after you start changing things.',
    confidence: 'medium',
  },
];

export interface BuildPlanParams {
  input: FirstMoveInput;
  redactedDescription: string;
  redactionApplied: boolean;
  /** When a seed phrase / private key was detected — deterministic path, no model. */
  forceExposure: boolean;
  classifier: Classifier | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function meta(redactionApplied: boolean): FirstMoveOutput['meta'] {
  return {
    asp: 'KeepFlow',
    service: config.service.name,
    schema_version: '1.0.0',
    generated_at: nowIso(),
    redaction_applied: redactionApplied,
  };
}

function buildKnownPlan(
  runbook: Runbook,
  method: ClassificationMethod,
  confidence: Confidence,
  redactionApplied: boolean,
  selectedActionIds?: string[],
): FirstMoveOutput {
  // Membership: keep only ids that exist in this runbook; ignore anything else.
  const validIds = new Set(runbook.actions.map((a) => a.id));
  const filtered = (selectedActionIds ?? []).filter((id) => validIds.has(id));
  const selected =
    filtered.length > 0
      ? runbook.actions.filter((a) => filtered.includes(a.id))
      : runbook.actions;

  const { actions, stepById } = orderActions(selected);
  const cascade = buildCascade(runbook.cascade, selected, stepById);

  return {
    incident_type: runbook.incidentType,
    runbook_id: runbook.id,
    runbook_version: runbook.version,
    classification: { confidence, method },
    assumptions: [...runbook.assumptions],
    immediate_actions: actions,
    cascade,
    material_unknowns: [...runbook.materialUnknowns],
    questions: runbook.questions.slice(0, 5),
    limitations: [...runbook.limitations],
    unsupported_areas: [...runbook.unsupportedAreas],
    meta: meta(redactionApplied),
  };
}

function buildUnknownPlan(
  method: ClassificationMethod,
  redactionApplied: boolean,
): FirstMoveOutput {
  const { actions } = orderActions(UNKNOWN_ACTIONS);
  return {
    incident_type: 'unknown',
    runbook_id: 'digital-access/unknown-triage',
    runbook_version: '1.0.0',
    classification: { confidence: 'low', method },
    assumptions: [
      'The incident could not be confidently matched to a supported recovery playbook.',
      'These are universal safety steps, not a specific recovery plan.',
    ],
    immediate_actions: actions,
    cascade: [], // never invent a cascade for an unknown incident
    material_unknowns: [
      'What specifically was lost, exposed, or accessed.',
      'Whether the incident involves a device, an account, a credential, or funds.',
      'Whether anyone else currently has access.',
    ],
    questions: [
      'What exactly happened — what was lost, exposed, or accessed?',
      'Is a device, an online account, or a crypto wallet involved?',
      'Do you still have access, or are you locked out?',
    ],
    limitations: [
      'This service supports stolen/lost phones, account takeover, lost 2FA, and seed/key exposure. Other incidents receive only general safety guidance.',
    ],
    unsupported_areas: [
      'Incidents outside the four supported digital-access scenarios.',
    ],
    meta: meta(redactionApplied),
  };
}

/**
 * Full hybrid pipeline: deterministic classify → optional model refine/select →
 * assemble. Returns a plan not yet validated (see validate-plan / repair-plan).
 */
export async function assemblePlan(params: BuildPlanParams): Promise<FirstMoveOutput> {
  const { redactedDescription, redactionApplied, forceExposure, classifier } = params;

  // Detected secret exposure → deterministic exposure runbook, no model call.
  if (forceExposure) {
    return buildKnownPlan(EXPOSURE_RUNBOOK, 'deterministic', 'high', redactionApplied);
  }

  const deterministic = classifyDeterministic(redactedDescription);

  let type: IncidentType = deterministic.type;
  let confidence: Confidence = deterministic.confidence;
  let method: ClassificationMethod = 'deterministic';
  let selectedActionIds: string[] | undefined;

  // The curated deterministic classifier owns clear classifications. The
  // model is a refiner for genuinely ambiguous/unknown descriptions only;
  // keeping it off the high/medium-confidence path avoids unnecessary cost
  // and latency and prevents a model from overriding a clear runbook match.
  if (classifier && deterministic.confidence === 'low') {
    const model = await classifier.classify(params.input, redactedDescription);
    if (model) {
      type = model.incidentType;
      confidence = model.confidence;
      method = 'model';
      selectedActionIds = model.selectedActionIds;
    } else {
      method = 'model_fallback_deterministic';
    }
  }

  if (type === 'unknown') {
    return buildUnknownPlan(method, redactionApplied);
  }

  const runbook = getRunbook(type);
  if (!runbook) {
    // Model named a type we don't have a runbook for — treat as unknown.
    return buildUnknownPlan('model_fallback_deterministic', redactionApplied);
  }

  return buildKnownPlan(runbook, method, confidence, redactionApplied, selectedActionIds);
}

/** Exposed for tests. */
export const _internal = { UNKNOWN_ACTIONS, RUNBOOKS };

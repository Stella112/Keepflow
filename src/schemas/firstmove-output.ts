import { z } from 'zod';
import { ContextRoutingOutputSchema } from './context-routing-output.js';

/**
 * First Move response schema.
 *
 * Shape follows the agreed design + correction addendum: incident
 * classification, an ordered list of conditional actions, an explicit
 * dependency cascade, material unknowns, clarifying questions, and honest
 * limitations. Every response is traceable to a versioned runbook.
 *
 * NOTE: this schema enforces STRUCTURE only. Semantic qualities (relevance,
 * ordering quality, cascade correctness, non-genericness) are NOT enforced
 * here — they are assessed separately in engine/evaluate-plan. Do not read a
 * passing schema validation as a semantic guarantee.
 */

export const IncidentType = z.enum([
  'stolen_or_lost_phone',
  'account_takeover',
  'lost_authenticator',
  'seed_or_key_exposure',
  'unknown',
]);
export type IncidentType = z.infer<typeof IncidentType>;

export const Urgency = z.enum(['immediate', 'urgent', 'soon', 'followup']);
export type Urgency = z.infer<typeof Urgency>;

/**
 * Priority classes, in ranking order. Actions are ordered by class first
 * (safety before everything), then by urgency within a class. This is why the
 * output is ORDER, not a flat checklist.
 */
export const PriorityClass = z.enum([
  'safety', // personal / physical safety
  'irreversible_loss', // stop active, unrecoverable loss
  'exploitable_access', // close access an attacker can still use right now
  'cascade', // break the downstream dependency chain
  'evidence', // preserve evidence
  'recovery', // longer-window recovery / cleanup
]);
export type PriorityClass = z.infer<typeof PriorityClass>;

export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

export const Risk = z.enum(['high', 'medium', 'low']);
export type Risk = z.infer<typeof Risk>;

export const ActionSchema = z
  .object({
    step: z.number().int().positive(),
    action: z.string().min(1),
    urgency: Urgency,
    priority_class: PriorityClass,
    /**
     * The trigger. REQUIRED. Universal actions state applicability explicitly;
     * conditional actions state the fact the caller must self-assess. This
     * prevents conditional advice from reading as universally correct.
     */
    condition: z.string().min(1),
    reason: z.string().min(1),
    confidence: Confidence,
    /** Class of provider/authority/trusted person to involve, if any. */
    provider_class: z.string().min(1).optional(),
    /** Evidence this step helps preserve. */
    evidence: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type Action = z.infer<typeof ActionSchema>;

export const CascadeLinkSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    mechanism: z.string().min(1),
    risk: Risk,
    /** Step numbers whose actions reduce this link's risk. */
    mitigated_by: z.array(z.number().int().positive()).optional(),
  })
  .strict();
export type CascadeLink = z.infer<typeof CascadeLinkSchema>;

export const ClassificationSchema = z
  .object({
    confidence: Confidence,
    /** How the incident was classified: deterministic keywords or the model. */
    method: z.enum(['deterministic', 'model', 'model_fallback_deterministic']),
  })
  .strict();

export const MetaSchema = z
  .object({
    asp: z.literal('KeepFlow'),
    service: z.string().min(1),
    schema_version: z.string().min(1),
    generated_at: z.string().datetime(),
    /** True when secret-shaped input was detected and redacted. */
    redaction_applied: z.boolean(),
  })
  .strict();

export const FirstMoveOutputSchema = z
  .object({
    incident_type: IncidentType,
    /** Traceability: which curated runbook produced this. */
    runbook_id: z.string().min(1),
    runbook_version: z.string().regex(/^\d+\.\d+\.\d+$/, 'semver required'),
    classification: ClassificationSchema,
    /** Assumptions the plan rests on. Never hidden. */
    assumptions: z.array(z.string().min(1)),
    /** Ordered, conditional recovery actions. */
    immediate_actions: z.array(ActionSchema).min(1),
    /**
     * Downstream dependency chain. Required (non-empty) for a known incident;
     * MUST be empty for `unknown` — we never invent a cascade to fill schema.
     */
    cascade: z.array(CascadeLinkSchema),
    /** Facts whose absence materially changes the plan. */
    material_unknowns: z.array(z.string().min(1)),
    /** Up to a few clarifying questions whose answers change the plan. */
    questions: z.array(z.string().min(1)).max(5),
    /** Honest statements of what this response did not or could not do. */
    limitations: z.array(z.string().min(1)),
    /** Areas explicitly out of scope for this service. */
    unsupported_areas: z.array(z.string().min(1)),
    context_routing: ContextRoutingOutputSchema.optional(),
    context_routing_notice: z.string().min(1).optional(),
    meta: MetaSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    // Cascade presence rule: known => non-empty; unknown => empty.
    if (val.incident_type === 'unknown' && val.cascade.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cascade'],
        message: 'unknown incidents must not include a cascade',
      });
    }
    if (val.incident_type !== 'unknown' && val.cascade.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cascade'],
        message: 'known incidents require a non-empty cascade',
      });
    }
  });

export type FirstMoveOutput = z.infer<typeof FirstMoveOutputSchema>;

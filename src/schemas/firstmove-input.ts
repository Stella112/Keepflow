import { z } from 'zod';
import { ContextEnrichmentRequestSchema } from './context-routing-input.js';

/**
 * First Move request. Deliberately minimal: a free-text description plus a few
 * optional structured context flags. We do NOT ask for identifiers, account
 * names, or anything credential-shaped. The description is scanned for secrets
 * and redacted before it ever reaches a model (see security/redact-secrets).
 */
export const FirstMoveInputSchema = z
  .object({
    /** What just went wrong, in the caller's own words. */
    description: z
      .string()
      .trim()
      .min(3, 'description is too short to triage')
      .max(4000, 'description is too long'),

    /**
     * Optional structured hints. These refine conditional actions (the
     * `condition` field on each action) without the model having to guess.
     * All optional — absence is treated as "unknown", never assumed true.
     */
    context: z
      .object({
        deviceWasUnlocked: z.boolean().optional(),
        authenticatorOnlyOnThatDevice: z.boolean().optional(),
        sharedPhoneNumberForRecovery: z.boolean().optional(),
        occurredWithinMinutes: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),

    /** Optional one-request location consent for relevant real-world help. */
    real_world_context: ContextEnrichmentRequestSchema.optional(),

  })
  .strict();

export type FirstMoveInput = z.infer<typeof FirstMoveInputSchema>;

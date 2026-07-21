import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { FirstMoveInputSchema } from '../schemas/firstmove-input.js';
import { redactSecrets } from '../security/redact-secrets.js';
import { dangerGate } from '../security/danger-gate.js';
import { misuseGate } from '../security/misuse-gate.js';
import { assemblePlan } from '../engine/build-plan.js';
import { validatePlan } from '../engine/validate-plan.js';
import { repairPlan } from '../engine/repair-plan.js';
import { evaluatePlan } from '../engine/evaluate-plan.js';
import { createModelClassifier, type Classifier } from '../engine/model-classifier.js';
import { log } from '../observability/logger.js';
import type { ContextRoutingProvider } from '../context/google-maps-provider.js';
import { buildContextRouting } from '../engine/context-routing.js';
import { contextInputForService, firstMoveCategories } from '../context/service-context.js';

/**
 * First Move route — produces the recovery plan. Payment (x402) is handled
 * upstream by the OKX SDK middleware in app.ts, so by the time a request
 * reaches here it is either free (payments disabled) or already paid.
 */

export interface FirstMoveDeps {
  classifier: Classifier | null;
  contextRoutingProvider?: ContextRoutingProvider;
}

export function createFirstMoveRouter(deps: FirstMoveDeps): Router {
  // Payment middleware matches canonical paths. Keep the paid handler equally
  // strict so case or trailing-slash aliases can never bypass x402.
  const router = Router({ caseSensitive: true, strict: true });
  const { classifier, contextRoutingProvider } = deps;

  router.post('/v1/first-move', async (req: Request, res: Response) => {
    const started = Date.now();

    const parseResult = FirstMoveInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'invalid_request',
        details: parseResult.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    const input = parseResult.data;

    // Scan for secrets BEFORE anything else, and never log the body.
    const redaction = redactSecrets(input.description);
    const danger = dangerGate(redaction.redacted);
    const misuse = misuseGate(redaction.redacted);
    const gate = danger.blocked ? danger : misuse.blocked ? misuse : null;
    if (gate) {
      res.status(403).json({ error: 'request_blocked', category: gate.category, reason: gate.reason });
      log.warn('firstmove.blocked', { category: gate.category ?? 'unknown' });
      return;
    }

    try {
      let plan = await assemblePlan({
        input,
        redactedDescription: redaction.redacted,
        redactionApplied: redaction.redactionApplied,
        forceExposure: redaction.seedOrKeyDetected,
        classifier,
      });

      let validation = validatePlan(plan);
      if (!validation.valid) {
        const repair = repairPlan(plan);
        plan = repair.repaired;
        validation = { valid: repair.valid, errors: repair.errors };
      }
      if (!validation.valid) {
        log.error('firstmove.invalid', { errors: validation.errors });
        res.status(500).json({ error: 'plan_generation_failed' });
        return;
      }

      if (input.real_world_context) {
        const categories = firstMoveCategories(plan.incident_type);
        if (!categories.length) {
          plan = {
            ...plan,
            context_routing_notice: 'No real-world place category was relevant enough to this incident to justify a location lookup.',
          };
        } else if (contextRoutingProvider) {
          try {
            const contextInput = contextInputForService({
              sourceService: 'first_move',
              need: `Find practical staffed support for a ${plan.incident_type.replaceAll('_', ' ')} incident.`,
              request: {
                ...input.real_world_context,
                search: { ...input.real_world_context.search, urgency: 'urgent' },
              },
              categories,
            });
            plan = {
              ...plan,
              context_routing: await buildContextRouting(contextInput, contextRoutingProvider),
            };
          } catch {
            plan = {
              ...plan,
              context_routing_notice: 'Live place enrichment was unavailable; the ordered recovery plan remains usable and no location facts were invented.',
            };
          }
        }
      }

      validation = validatePlan(plan);
      if (!validation.valid) {
        log.error('firstmove.context_invalid', { errors: validation.errors });
        res.status(500).json({ error: 'plan_generation_failed' });
        return;
      }

      const evaluation = evaluatePlan(plan);
      log.info('firstmove.ok', {
        incident_type: plan.incident_type,
        method: plan.classification.method,
        redaction: redaction.redactionApplied,
        seed_exposure: redaction.seedOrKeyDetected,
        warnings: evaluation.warnings,
        latency_ms: Date.now() - started,
      });
      res.json(plan);
    } catch (err) {
      log.error('firstmove.error', { message: err instanceof Error ? err.message : 'unknown' });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

export const firstMoveRouter = createFirstMoveRouter({
  classifier: createModelClassifier(config),
});

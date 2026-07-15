import { createHash } from 'node:crypto';
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
import { createResultStore, type ResultStore } from '../payments/result-cache.js';
import { buildRequirement, createPaymentGate } from '../payments/okx-x402.js';
import { createHttpFacilitator, type Facilitator } from '../payments/facilitator.js';
import { log } from '../observability/logger.js';

/** Derive a stable idempotency key from the payload — no secrets involved
 *  because the description is hashed, not stored or logged. */
function deriveKey(description: string, context: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ description, context: context ?? null }))
    .digest('hex');
}

function encodePaymentResponse(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export interface FirstMoveDeps {
  classifier: Classifier | null;
  resultStore: ResultStore;
  paymentGate: ReturnType<typeof createPaymentGate>;
  facilitator: Facilitator | null;
}

export function createFirstMoveRouter(deps: FirstMoveDeps): Router {
  const router = Router();
  const { classifier, resultStore, paymentGate, facilitator } = deps;

  // Payments settled for a given key — prevents double-charging on a replay.
  const settledKeys = new Set<string>();

  router.post('/v1/first-move', paymentGate, async (req: Request, res: Response) => {
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

    // Idempotency: settled payment id > caller key > payload hash.
    const key =
      req.paymentId ?? input.idempotencyKey ?? deriveKey(input.description, input.context);

    // Produce or fetch the plan.
    let output = resultStore.get(key);
    const replay = output !== undefined;

    if (!output) {
      const redaction = redactSecrets(input.description);
      const danger = dangerGate(redaction.redacted);
      const misuse = misuseGate(redaction.redacted);
      const gate = danger.blocked ? danger : misuse.blocked ? misuse : null;
      if (gate) {
        // Blocked before any plan is produced → nothing to settle, no charge.
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

        const evaluation = evaluatePlan(plan);
        resultStore.set(key, plan);
        output = plan;
        log.info('firstmove.ok', {
          incident_type: plan.incident_type,
          method: plan.classification.method,
          redaction: redaction.redactionApplied,
          seed_exposure: redaction.seedOrKeyDetected,
          warnings: evaluation.warnings,
          latency_ms: Date.now() - started,
        });
      } catch (err) {
        log.error('firstmove.error', { message: err instanceof Error ? err.message : 'unknown' });
        res.status(500).json({ error: 'internal_error' });
        return;
      }
    }

    // Settlement — only when a verified payment is attached. We settle AFTER a
    // valid plan exists, so the caller is charged only on success, and only
    // once per payment.
    if (req.x402 && facilitator) {
      if (settledKeys.has(key)) {
        res.setHeader('PAYMENT-RESPONSE', encodePaymentResponse({ status: 'already_settled' }));
      } else {
        let settle;
        try {
          settle = await facilitator.settle(req.x402.proof, req.x402.requirement);
        } catch (err) {
          res.status(402).json({
            error: 'settlement_failed',
            reason: err instanceof Error ? err.message : 'facilitator error',
          });
          return;
        }
        if (!settle.settled) {
          res.status(402).json({ error: 'settlement_failed', reason: settle.reason ?? 'not settled' });
          return;
        }
        settledKeys.add(key);
        res.setHeader(
          'PAYMENT-RESPONSE',
          encodePaymentResponse({
            status: 'settled',
            network: req.x402.requirement.network,
            amount: req.x402.requirement.price,
            ...(settle.txHash ? { transaction: settle.txHash } : {}),
          }),
        );
        log.info('firstmove.settled', { replay, tx: settle.txHash ?? 'n/a' });
      }
    }

    if (replay) res.setHeader('X-Idempotent-Replay', 'true');
    res.json(output);
  });

  return router;
}

// Default instance, wired from config, used by the app.
const facilitator: Facilitator | null =
  config.payments.enabled && config.payments.facilitatorUrl
    ? createHttpFacilitator(config.payments.facilitatorUrl)
    : null;

export const firstMoveRouter = createFirstMoveRouter({
  classifier: createModelClassifier(config),
  resultStore: createResultStore(config.resultCache.ttlSeconds),
  facilitator,
  paymentGate: createPaymentGate({
    enabled: config.payments.enabled,
    requirement: buildRequirement(config),
    facilitator,
  }),
});

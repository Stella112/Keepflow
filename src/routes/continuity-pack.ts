import { Router, type NextFunction, type Request, type Response } from 'express';
import { buildContinuityPack } from '../engine/continuity-pack.js';
import {
  recordContinuityPackFailure,
  recordContinuityPackSuccess,
} from '../observability/continuity-metrics.js';
import { log } from '../observability/logger.js';
import { markPaidRouteBodyPrevalidated } from '../payments/paid-routes.js';
import {
  ContinuityPackInputSchema,
  type ContinuityPackInput,
} from '../schemas/continuity-pack-input.js';
import { dangerGate } from '../security/danger-gate.js';
import { misuseGate } from '../security/misuse-gate.js';
import {
  maskStudyAssistPersonalData,
  scanStudyAssistSecrets,
  type StudyAssistPersonalDataCategory,
} from '../security/study-assist-guard.js';

const INPUT_LOCAL = 'continuityPackInput';
const PERSONAL_DATA_LOCAL = 'continuityPackPersonalDataMasked';
const CLEANUP_LOCAL = 'continuityPackCleanup';
type Cleanup = () => void;

function installCleanup(req: Request, res: Response): Cleanup {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const input = res.locals[INPUT_LOCAL] as ContinuityPackInput | undefined;
    if (input) {
      input.description = '';
      input.location.country = '';
      if (input.location.city_or_area) input.location.city_or_area = '';
      input.immediate_deadlines.forEach((deadline) => {
        deadline.label = '';
      });
      input.immediate_deadlines.length = 0;
      input.stakeholders.length = 0;
    }
    delete res.locals[INPUT_LOCAL];
    delete res.locals[PERSONAL_DATA_LOCAL];
    delete res.locals[CLEANUP_LOCAL];
    req.body = {};
  };
  res.locals[CLEANUP_LOCAL] = cleanup;
  res.once('finish', cleanup);
  res.once('close', cleanup);
  return cleanup;
}

function maskText(
  value: string,
  categories: Set<StudyAssistPersonalDataCategory>,
): string {
  const masked = maskStudyAssistPersonalData(value);
  masked.categories.forEach((category) => categories.add(category));
  return masked.masked_text;
}

function sanitizeInput(
  input: ContinuityPackInput,
  categories: Set<StudyAssistPersonalDataCategory>,
): ContinuityPackInput {
  return {
    ...input,
    description: maskText(input.description, categories),
    location: {
      ...input.location,
      country: maskText(input.location.country, categories),
      city_or_area: input.location.city_or_area
        ? maskText(input.location.city_or_area, categories)
        : undefined,
    },
    immediate_deadlines: input.immediate_deadlines.map((deadline) => ({
      ...deadline,
      label: maskText(deadline.label, categories),
    })),
  };
}

export function continuityPackPrepaymentGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.locals[INPUT_LOCAL]) {
    next();
    return;
  }
  const parsed = ContinuityPackInputSchema.safeParse(req.body);
  if (!parsed.success) {
    req.body = {};
    res.status(400).json({
      error: 'invalid_request',
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const danger = dangerGate(parsed.data.description);
  const misuse = misuseGate(parsed.data.description);
  const blocked = danger.blocked ? danger : misuse.blocked ? misuse : null;
  if (blocked) {
    req.body = {};
    log.warn('continuitypack.blocked', { category: blocked.category ?? 'unknown' });
    res.status(403).json({
      error: 'request_blocked',
      category: blocked.category,
      reason: blocked.reason,
    });
    return;
  }

  const secretScan = scanStudyAssistSecrets({
    title: parsed.data.situation_type,
    topic: parsed.data.description,
    question: [parsed.data.location.country, parsed.data.location.city_or_area].filter(Boolean).join(', '),
    output_language: parsed.data.output_language,
    extracted_chunks: parsed.data.immediate_deadlines.map((deadline) => deadline.label),
  });
  if (secretScan.detected) {
    req.body = {};
    log.warn('continuitypack.sensitive_input', { categories: secretScan.categories });
    res.status(400).json({
      error: 'sensitive_data_detected',
      categories: secretScan.categories,
      message: 'Remove passwords, PINs, payment-card data, OTP codes, recovery codes, access tokens, seed phrases, private keys, and connection credentials before creating a continuity pack.',
    });
    return;
  }

  const personalData = new Set<StudyAssistPersonalDataCategory>();
  const sanitized = sanitizeInput(parsed.data, personalData);
  req.body = {};
  res.locals[INPUT_LOCAL] = sanitized;
  res.locals[PERSONAL_DATA_LOCAL] = [...personalData];
  const cleanup = installCleanup(req, res);
  if (!markPaidRouteBodyPrevalidated(res, req.method, req.path, sanitized)) {
    cleanup();
    res.status(500).json({ error: 'paid_route_prevalidation_failed' });
    return;
  }
  next();
}

export const continuityPackRouter = Router({ caseSensitive: true, strict: true });

continuityPackRouter.post(
  '/v1/continuity-pack',
  continuityPackPrepaymentGuard,
  async (req: Request, res: Response) => {
    const started = Date.now();
    const input = res.locals[INPUT_LOCAL] as ContinuityPackInput | undefined;
    const personalData = (
      res.locals[PERSONAL_DATA_LOCAL] ?? []
    ) as StudyAssistPersonalDataCategory[];
    if (!input) {
      recordContinuityPackFailure();
      res.status(500).json({ error: 'continuity_preflight_missing' });
      return;
    }
    try {
      const output = await buildContinuityPack(input, personalData);
      const latency = Date.now() - started;
      recordContinuityPackSuccess(latency, Object.keys(output.artifacts).length);
      log.info('continuitypack.ok', {
        situation_type: output.situation_type,
        action_count:
          output.timeline.next_15_minutes.length +
          output.timeline.today.length +
          output.timeline.next_seven_days.length,
        message_count: output.ready_to_send_messages.length,
        delegation_count: output.delegation_cards.length,
        artifact_count: Object.keys(output.artifacts).length,
        artifact_bytes: Object.values(output.artifacts)
          .reduce((sum, artifact) => sum + artifact.byte_length, 0),
        personal_data_masked: personalData,
        latency_ms: latency,
      });
      res.json(output);
    } catch (error) {
      recordContinuityPackFailure();
      log.error('continuitypack.error', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      res.status(500).json({ error: 'continuity_generation_failed' });
    } finally {
      const cleanup = res.locals[CLEANUP_LOCAL] as Cleanup | undefined;
      if (cleanup) cleanup();
    }
  },
);

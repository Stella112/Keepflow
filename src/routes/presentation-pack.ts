import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from '../config.js';
import { buildPresentationPack } from '../engine/presentation-pack.js';
import {
  createPresentationPlanner,
  type PresentationPlanner,
} from '../engine/presentation-plan.js';
import { log } from '../observability/logger.js';
import { markPaidRouteBodyPrevalidated } from '../payments/paid-routes.js';
import {
  PresentationPackInputSchema,
  type PresentationPackInput,
} from '../schemas/presentation-pack-input.js';
import {
  classifyStudyAssistAcademicIntegrity,
  detectStudyAssistAcademicMisuse,
  maskStudyAssistPersonalData,
  scanStudyAssistSecrets,
  type StudyAssistPersonalDataCategory,
} from '../security/study-assist-guard.js';

const INPUT_LOCAL = 'presentationPackInput';
const PERSONAL_DATA_LOCAL = 'presentationPackPersonalDataMasked';
const CLEANUP_LOCAL = 'presentationPackCleanup';

type Cleanup = () => void;

function invalidRequest(res: Response, issues: { path: (PropertyKey | number)[]; message: string }[]): void {
  res.status(400).json({
    error: 'invalid_request',
    details: issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

function installCleanup(req: Request, res: Response): Cleanup {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const input = res.locals[INPUT_LOCAL] as PresentationPackInput | undefined;
    if (input) {
      input.title = '';
      input.purpose = '';
      input.audience = '';
      for (const source of input.source_items) {
        source.label = '';
        source.content = '';
      }
      input.source_items.length = 0;
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

function maskField(
  value: string,
  categories: Set<StudyAssistPersonalDataCategory>,
): string {
  const result = maskStudyAssistPersonalData(value);
  result.categories.forEach((category) => categories.add(category));
  return result.masked_text;
}

function sanitizeInput(
  input: PresentationPackInput,
  categories: Set<StudyAssistPersonalDataCategory>,
): PresentationPackInput {
  return {
    ...input,
    title: maskField(input.title, categories),
    purpose: maskField(input.purpose, categories),
    audience: maskField(input.audience, categories),
    output_language: maskField(input.output_language, categories),
    source_items: input.source_items.map((item) => ({
      ...item,
      label: maskField(item.label, categories),
      content: maskField(item.content, categories),
    })),
    branding: {
      ...input.branding,
      brand_name: input.branding.brand_name
        ? maskField(input.branding.brand_name, categories)
        : undefined,
      footer_text: input.branding.footer_text
        ? maskField(input.branding.footer_text, categories)
        : undefined,
    },
  };
}

export function presentationPackPrepaymentGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.locals[INPUT_LOCAL]) {
    next();
    return;
  }

  const parsed = PresentationPackInputSchema.safeParse(req.body);
  if (!parsed.success) {
    req.body = {};
    invalidRequest(res, parsed.error.issues);
    return;
  }

  if (parsed.data.domain === 'study') {
    const concealed = detectStudyAssistAcademicMisuse([
      parsed.data.title,
      parsed.data.purpose,
      parsed.data.audience,
    ]);
    const decision = classifyStudyAssistAcademicIntegrity(
      concealed ?? parsed.data.academic_integrity?.requested_action ?? 'unsupported',
    );
    if (!decision.model_contact_allowed) {
      req.body = {};
      log.warn('presentationpack.integrity_redirect', { reason: decision.reason_code });
      res.status(403).json({
        error: 'academic_integrity_redirect',
        reason: decision.reason_code,
        message: 'KeepFlow can prepare grounded learning presentations but cannot produce assessed submissions or impersonate a learner.',
        safe_alternative: decision.safe_alternative,
      });
      return;
    }
  }

  const secretScan = scanStudyAssistSecrets({
    title: parsed.data.title,
    topic: parsed.data.purpose,
    question: parsed.data.audience,
    output_language: parsed.data.output_language,
    extracted_chunks: parsed.data.source_items.flatMap((item) => [item.label, item.content]),
  });
  if (secretScan.detected) {
    req.body = {};
    log.warn('presentationpack.sensitive_input', { categories: secretScan.categories });
    res.status(400).json({
      error: 'sensitive_data_detected',
      categories: secretScan.categories,
      message: 'Remove passwords, private keys, payment-card data, OTP codes, access tokens, and connection credentials before creating a presentation.',
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

export function createPresentationPackRouter(
  planner: PresentationPlanner | null = createPresentationPlanner(config),
): Router {
  const router = Router({ caseSensitive: true, strict: true });
  router.post(
    '/v1/presentation-pack',
    presentationPackPrepaymentGuard,
    async (req: Request, res: Response) => {
      const started = Date.now();
      const input = res.locals[INPUT_LOCAL] as PresentationPackInput | undefined;
      const personalData = (
        res.locals[PERSONAL_DATA_LOCAL] ?? []
      ) as StudyAssistPersonalDataCategory[];
      if (!input) {
        res.status(500).json({ error: 'presentation_preflight_missing' });
        return;
      }
      try {
        const { output, inspection } = await buildPresentationPack(
          input,
          planner,
          personalData,
        );
        log.info('presentationpack.ok', {
          domain: output.domain,
          generation_mode: output.generation_mode,
          slide_count: output.slide_count,
          byte_length: output.presentation_file.byte_length,
          archive_entries: inspection.archiveEntryCount,
          personal_data_masked: personalData,
          latency_ms: Date.now() - started,
        });
        res.json(output);
      } catch (error) {
        log.error('presentationpack.error', {
          message: error instanceof Error ? error.message : 'unknown',
        });
        res.status(500).json({ error: 'presentation_generation_failed' });
      } finally {
        const cleanup = res.locals[CLEANUP_LOCAL] as Cleanup | undefined;
        if (cleanup) cleanup();
      }
    },
  );
  return router;
}

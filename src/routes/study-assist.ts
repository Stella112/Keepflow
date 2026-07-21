import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from '../config.js';
import {
  buildStudyAssist,
  validateStudyAssistOutput,
  type StudyAssistDependencies,
  type StudyAssistPreflightData,
  type StudyAssistRuntimeInput,
} from '../engine/study-assist.js';
import {
  extractStudyMaterial,
  StudyMaterialError,
  type ExtractedStudyMaterial,
} from '../engine/study-material-extractor.js';
import { createStudyTutor } from '../engine/study-tutor-model.js';
import { log } from '../observability/logger.js';
import { markPaidRouteBodyPrevalidated } from '../payments/paid-routes.js';
import { StudyAssistInputSchema } from '../schemas/study-assist-input.js';
import {
  classifyStudyAssistAcademicIntegrity,
  detectStudyAssistAcademicMisuse,
  maskStudyAssistPersonalData,
  scanStudyAssistSecrets,
  type StudyAssistPersonalDataCategory,
} from '../security/study-assist-guard.js';

const PREFLIGHT_LOCAL = 'studyAssistPreflight';
const CLEANUP_LOCAL = 'studyAssistCleanup';

type StudyAssistCleanup = () => void;

function invalidRequest(res: Response, issues: { path: (PropertyKey | number)[]; message: string }[]): void {
  res.status(400).json({
    error: 'invalid_request',
    details: issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

function cleanupStudyAssist(req: Request, res: Response): void {
  const existing = res.locals[CLEANUP_LOCAL] as StudyAssistCleanup | undefined;
  if (existing) existing();
  req.body = {};
}

function installCleanup(req: Request, res: Response): StudyAssistCleanup {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const preflight = res.locals[PREFLIGHT_LOCAL] as StudyAssistPreflightData | undefined;
    if (preflight?.material) {
      preflight.material.title = '';
      for (const chunk of preflight.material.chunks) chunk.excerpt = '';
      preflight.material.chunks.length = 0;
    }
    delete res.locals[PREFLIGHT_LOCAL];
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
  const masked = maskStudyAssistPersonalData(value);
  masked.categories.forEach((category) => categories.add(category));
  return masked.masked_text;
}

function maskMaterial(
  material: ExtractedStudyMaterial,
  categories: Set<StudyAssistPersonalDataCategory>,
): ExtractedStudyMaterial {
  return {
    ...material,
    title: maskField(material.title, categories),
    chunks: material.chunks.map((chunk) => ({
      ...chunk,
      // The masker preserves UTF-16 length, whitespace and line structure, so
      // every exact citation offset remains valid after direct identifiers are removed.
      excerpt: maskField(chunk.excerpt, categories),
    })),
    coverage: { ...material.coverage },
  };
}

function sanitizeRuntimeInput(
  input: ReturnType<typeof StudyAssistInputSchema.parse>,
  categories: Set<StudyAssistPersonalDataCategory>,
): StudyAssistRuntimeInput {
  const { material: _discardedRawMaterial, ...runtime } = input;
  return {
    ...runtime,
    subject: maskField(runtime.subject, categories),
    topic: maskField(runtime.topic, categories),
    question: runtime.question ? maskField(runtime.question, categories) : undefined,
    output_language: maskField(runtime.output_language, categories),
    research: {
      ...runtime.research,
      query: runtime.research.query
        ? maskField(runtime.research.query, categories)
        : undefined,
    },
  };
}

/**
 * Parse, bound, extract and sanitize the upload before x402. No external
 * provider is contacted here, so customers are not charged for an unusable or
 * prohibited request and unpaid callers cannot trigger model/research spend.
 */
export async function studyAssistPrepaymentGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (res.locals[PREFLIGHT_LOCAL]) {
    next();
    return;
  }

  const parsed = StudyAssistInputSchema.safeParse(req.body);
  if (!parsed.success) {
    req.body = {};
    invalidRequest(res, parsed.error.issues);
    return;
  }

  const concealedMisuse = detectStudyAssistAcademicMisuse([
    parsed.data.subject,
    parsed.data.topic,
    parsed.data.question,
    parsed.data.research.query,
  ]);
  const integrity = classifyStudyAssistAcademicIntegrity(
    concealedMisuse ?? parsed.data.academic_integrity.requested_action,
  );
  if (!integrity.model_contact_allowed) {
    req.body = {};
    log.warn('studyassist.integrity_redirect', { reason: integrity.reason_code });
    res.status(403).json({
      error: 'academic_integrity_redirect',
      reason: integrity.reason_code,
      message: 'KeepFlow Study supports learning, explanation, practice, and citation guidance, but cannot complete assessed work or impersonate a learner.',
      safe_alternative: integrity.safe_alternative,
    });
    return;
  }

  try {
    const extracted = parsed.data.material
      ? await extractStudyMaterial(parsed.data.material)
      : null;
    const secretScan = scanStudyAssistSecrets({
      title: extracted?.title,
      subject: parsed.data.subject,
      topic: parsed.data.topic,
      question: parsed.data.question,
      output_language: parsed.data.output_language,
      query: parsed.data.research.query,
      extracted_chunks: extracted?.chunks.map((chunk) => chunk.excerpt),
    });
    if (secretScan.detected) {
      req.body = {};
      log.warn('studyassist.sensitive_input', { categories: secretScan.categories });
      res.status(400).json({
        error: 'sensitive_data_detected',
        categories: secretScan.categories,
        message: 'Remove passwords, private keys, payment-card data, OTP codes, access tokens, and connection credentials before using Study Assist.',
      });
      return;
    }

    const personalData = new Set<StudyAssistPersonalDataCategory>();
    const runtimeInput = sanitizeRuntimeInput(parsed.data, personalData);
    const sanitizedMaterial = extracted ? maskMaterial(extracted, personalData) : null;
    const preflight: StudyAssistPreflightData = {
      input: runtimeInput,
      material: sanitizedMaterial,
      materialType: parsed.data.material?.type ?? null,
      personalDataMasked: [...personalData],
    };

    // Drop the original base64/text body before payment middleware and keep
    // only bounded, sanitized runtime data in server-owned response locals.
    req.body = {};
    res.locals[PREFLIGHT_LOCAL] = preflight;
    installCleanup(req, res);
    if (!markPaidRouteBodyPrevalidated(res, req.method, req.path, preflight)) {
      cleanupStudyAssist(req, res);
      res.status(500).json({ error: 'paid_route_prevalidation_failed' });
      return;
    }
    next();
  } catch (error) {
    req.body = {};
    if (error instanceof StudyMaterialError) {
      log.warn('studyassist.material_rejected', { code: error.code });
      res.status(error.status).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
    log.error('studyassist.preflight_error', {
      message: error instanceof Error ? error.name : 'unknown',
    });
    res.status(500).json({ error: 'study_assist_preflight_failed' });
  }
}

function defaultDependencies(): StudyAssistDependencies {
  const tutor = createStudyTutor(config);
  return {
    tutor,
    tutorModel: tutor ? config.studyAssistant.model : null,
    researchOptions: {
      contactEmail: config.research.crossrefMailto,
      timeoutMs: config.research.timeoutMs,
    },
  };
}

export function createStudyAssistRouter(
  dependencies: StudyAssistDependencies = defaultDependencies(),
): Router {
  const router = Router({ caseSensitive: true, strict: true });
  router.post(
    '/v1/study-assist',
    studyAssistPrepaymentGuard,
    createStudyAssistHandler(dependencies),
  );
  return router;
}

export function createStudyAssistHandler(
  dependencies: StudyAssistDependencies = defaultDependencies(),
) {
  return async (req: Request, res: Response): Promise<void> => {
      const started = Date.now();
      const preflight = res.locals[PREFLIGHT_LOCAL] as StudyAssistPreflightData | undefined;
      if (!preflight) {
        res.status(500).json({ error: 'study_assist_preflight_missing' });
        return;
      }

      try {
        const { output, researchResult } = await buildStudyAssist(preflight, dependencies);
        const validation = validateStudyAssistOutput(output, preflight, researchResult);
        if (!validation.valid) {
          log.error('studyassist.invalid', { error_count: validation.errors.length });
          res.status(500).json({ error: 'study_assist_generation_failed' });
          return;
        }
        log.info('studyassist.ok', {
          operation: output.operation,
          mode: output.mode,
          citation_count: output.material_citations.length,
          source_count: output.research_sources.length,
          personal_data_masked: preflight.personalDataMasked,
          latency_ms: Date.now() - started,
        });
        res.json(output);
      } catch (error) {
        log.error('studyassist.error', {
          message: error instanceof Error ? error.name : 'unknown',
        });
        res.status(500).json({ error: 'study_assist_generation_failed' });
      } finally {
        cleanupStudyAssist(req, res);
      }
  };
}

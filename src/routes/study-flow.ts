import { Router, type Request, type Response } from 'express';
import { buildStudyFlow, validateStudyFlow } from '../engine/study-flow.js';
import { log } from '../observability/logger.js';
import { StudyFlowInputSchema } from '../schemas/study-flow-input.js';

/**
 * KeepFlow Study is deterministic and stateless. Shared OKX x402 payment
 * middleware is mounted before this router by app.ts.
 */
// Paid routes must match the canonical x402 path exactly.
export const studyFlowRouter = Router({ caseSensitive: true, strict: true });

studyFlowRouter.post('/v1/study-flow', (req: Request, res: Response) => {
  const started = Date.now();
  const parsed = StudyFlowInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_request',
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  try {
    const output = buildStudyFlow(parsed.data);
    const validation = validateStudyFlow(output, parsed.data);
    if (!validation.valid) {
      log.error('studyflow.invalid', { errors: validation.errors });
      res.status(500).json({ error: 'plan_generation_failed' });
      return;
    }
    log.info('studyflow.ok', {
      mode: output.mode,
      feasibility: output.feasibility,
      task_count: output.priority_queue.length,
      session_count: output.sessions.length,
      latency_ms: Date.now() - started,
    });
    res.json(output);
  } catch (error) {
    log.error('studyflow.error', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

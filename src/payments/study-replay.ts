import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  captureStudyServiceReplaySnapshot,
  restoreStudyServiceReplaySnapshot,
  type StudyServiceReplaySnapshot,
} from '../routes/study.js';

const REPLAY_QUERY_KEY = '_keepflow_replay';
const REPLAY_TTL_MS = 5 * 60_000;

export const STUDY_REPLAY_RECOVERED_LOCAL = 'keepflowStudyReplayRecovered';

interface StoredStudyReplay {
  expiresAt: number;
  snapshot: StudyServiceReplaySnapshot;
}

const studyReplays = new Map<string, StoredStudyReplay>();

function hasPaymentCredential(req: Request): boolean {
  return Boolean(req.headers['payment-signature'] || req.headers['x-payment']);
}

function pruneExpiredReplays(now = Date.now()): void {
  for (const [token, replay] of studyReplays) {
    if (replay.expiresAt <= now) studyReplays.delete(token);
  }
}

function replayToken(req: Request): string | undefined {
  const value = req.query[REPLAY_QUERY_KEY];
  if (typeof value === 'string') return value;
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
}

/**
 * Save only the already validated and privacy-sanitized Study state. The
 * payment resource carries an opaque, short-lived reference rather than the
 * learner's material.
 */
export function captureStudyReplayForChallenge(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    req.method !== 'POST' ||
    req.path !== '/v1/study' ||
    hasPaymentCredential(req)
  ) {
    next();
    return;
  }

  const snapshot = captureStudyServiceReplaySnapshot(res);
  if (!snapshot) {
    next();
    return;
  }

  pruneExpiredReplays();
  const token = randomBytes(24).toString('base64url');
  studyReplays.set(token, {
    expiresAt: Date.now() + REPLAY_TTL_MS,
    snapshot,
  });
  const separator = req.originalUrl.includes('?') ? '&' : '?';
  req.originalUrl += `${separator}${REPLAY_QUERY_KEY}=${encodeURIComponent(token)}`;
  next();
}

/**
 * Restore the exact validated request before the paid replay reaches the
 * marketplace adapter or x402 settlement middleware.
 */
export function recoverStudyPaidReplay(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path !== '/v1/study' || !hasPaymentCredential(req)) {
    next();
    return;
  }

  const token = replayToken(req);
  if (!token) {
    next();
    return;
  }

  pruneExpiredReplays();
  const replay = studyReplays.get(token);
  if (!replay) {
    res.status(410).json({
      error: 'study_replay_expired',
      message: 'The saved Study request expired. Start a fresh request before paying again.',
    });
    return;
  }
  if (!restoreStudyServiceReplaySnapshot(req, res, replay.snapshot)) {
    res.status(500).json({ error: 'study_replay_restore_failed' });
    return;
  }

  res.locals[STUDY_REPLAY_RECOVERED_LOCAL] = true;
  res.once('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      studyReplays.delete(token);
    }
  });
  next();
}

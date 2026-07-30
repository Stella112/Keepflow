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
  const queryToken = typeof value === 'string'
    ? value
    : Array.isArray(value) && typeof value[0] === 'string'
      ? value[0]
      : undefined;
  if (queryToken) return queryToken;

  // Some OKX clients correctly sign the challenged resource URL but replay
  // against the original endpoint without its query string. Recover the
  // opaque reference from the signed v2 payment envelope in that case.
  const paymentHeader = req.headers['payment-signature'];
  if (typeof paymentHeader !== 'string' || paymentHeader.length > 32_768) {
    return undefined;
  }
  try {
    const envelope = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8')) as {
      resource?: { url?: unknown };
    };
    if (typeof envelope.resource?.url !== 'string') return undefined;
    const resource = new URL(envelope.resource.url);
    if (resource.pathname !== '/v1/study') return undefined;
    const token = resource.searchParams.get(REPLAY_QUERY_KEY) ?? undefined;
    return token && /^[A-Za-z0-9_-]{32}$/.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
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

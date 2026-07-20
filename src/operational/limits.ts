import type { RequestHandler } from 'express';
import { findPaidRoute, PAID_ROUTE_FINGERPRINT_LOCAL } from '../payments/paid-routes.js';

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const MAX_CLIENTS = 10_000;
const IDEMPOTENCY_TTL_MS = 15 * 60_000;
const MAX_IDEMPOTENCY_ENTRIES = 256;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{24,128}$/;

interface ClientWindow { startedAt: number; count: number }
interface CachedResponse { fingerprint: string; body: string; expiresAt: number }

export function createPaidRouteRateLimiter(): RequestHandler {
  const clients = new Map<string, ClientWindow>();
  return (req, res, next) => {
    if (!findPaidRoute(req.method, req.path)) return next();
    const now = Date.now();
    const key = req.ip || 'unknown';
    const current = clients.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
      clients.set(key, { startedAt: now, count: 1 });
      if (clients.size > MAX_CLIENTS) {
        const oldest = clients.keys().next().value as string | undefined;
        if (oldest) clients.delete(oldest);
      }
      return next();
    }
    current.count += 1;
    if (current.count > RATE_LIMIT) {
      const retryAfter = Math.max(1, Math.ceil((current.startedAt + RATE_WINDOW_MS - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'rate_limit_exceeded', retry_after_seconds: retryAfter });
      return;
    }
    next();
  };
}

export function createIdempotencyMiddleware(): RequestHandler {
  const cache = new Map<string, CachedResponse>();
  return (req, res, next) => {
    const route = findPaidRoute(req.method, req.path);
    if (!route) return next();
    const rawKey = req.header('Idempotency-Key');
    if (!rawKey) return next();
    if (!IDEMPOTENCY_KEY_RE.test(rawKey)) {
      res.status(400).json({
        error: 'invalid_idempotency_key',
        message: 'Idempotency-Key must be 24-128 characters using letters, numbers, dot, underscore, colon, or hyphen.',
      });
      return;
    }
    const fingerprint = res.locals[PAID_ROUTE_FINGERPRINT_LOCAL] as string | undefined;
    if (!fingerprint) {
      res.status(500).json({ error: 'request_fingerprint_missing' });
      return;
    }
    const cacheKey = `${route.method} ${route.path} ${rawKey}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt <= now) cache.delete(cacheKey);
    else if (cached) {
      if (cached.fingerprint !== fingerprint) {
        res.status(409).json({ error: 'idempotency_key_conflict' });
        return;
      }
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(200).type('application/json').send(cached.body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(cacheKey, {
          fingerprint,
          body: JSON.stringify(body),
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });
        while (cache.size > MAX_IDEMPOTENCY_ENTRIES) {
          const oldest = cache.keys().next().value as string | undefined;
          if (!oldest) break;
          cache.delete(oldest);
        }
      }
      return originalJson(body);
    }) as typeof res.json;
    next();
  };
}

export function createArtifactCapacityLimiter(maxConcurrent = 3): RequestHandler {
  let active = 0;
  return (req, res, next) => {
    if (req.method !== 'POST' || !['/v1/presentation-pack', '/v1/continuity-pack'].includes(req.path)) {
      return next();
    }
    if (active >= maxConcurrent) {
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: 'artifact_capacity_busy', retry_after_seconds: 5 });
      return;
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}

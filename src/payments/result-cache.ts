import type { FirstMoveOutput } from '../schemas/firstmove-output.js';

/**
 * Payment-aware idempotency store.
 *
 * A successfully produced result is cached against an idempotency key (a
 * caller-supplied key, or — once payments are wired — the x402 payment id).
 * Repeated delivery attempts for the same key return the stored result instead
 * of recomputing (and, under x402, instead of re-charging).
 *
 * We store ONLY the result, never the original incident text. This is a short
 * TTL in-memory store; a production deployment should back it with an external
 * store (e.g. Redis) and encrypt entries at rest — the interface below is what
 * such a backend would implement.
 */

export interface ResultStore {
  get(key: string): FirstMoveOutput | undefined;
  set(key: string, value: FirstMoveOutput): void;
  size(): number;
  clear(): void;
}

interface Entry {
  value: FirstMoveOutput;
  expiresAt: number;
}

export function createResultStore(ttlSeconds: number): ResultStore {
  const ttlMs = Math.max(1, ttlSeconds) * 1000;
  const map = new Map<string, Entry>();

  function purgeExpired(now: number): void {
    for (const [k, e] of map) {
      if (e.expiresAt <= now) map.delete(k);
    }
  }

  return {
    get(key) {
      const now = Date.now();
      const e = map.get(key);
      if (!e) return undefined;
      if (e.expiresAt <= now) {
        map.delete(key);
        return undefined;
      }
      return e.value;
    },
    set(key, value) {
      const now = Date.now();
      // Opportunistic cleanup keeps the map bounded without a timer.
      if (map.size > 0 && map.size % 128 === 0) purgeExpired(now);
      map.set(key, { value, expiresAt: now + ttlMs });
    },
    size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
  };
}

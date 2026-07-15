/**
 * Central configuration. Reads from process.env with safe defaults so the
 * service runs out-of-the-box in deterministic-only mode (no API key, no
 * payments) and can be progressively enabled.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export interface Config {
  port: number;
  nodeEnv: string;
  service: {
    asp: string;
    name: string;
    tagline: string;
    version: string;
  };
  classifier: {
    /** When false, the service never calls a model — deterministic only. */
    llmEnabled: boolean;
    apiKey: string | undefined;
    model: string;
    timeoutMs: number;
  };
  resultCache: {
    ttlSeconds: number;
  };
  payments: {
    /** UNVERIFIED external binding — off until confirmed against OKX docs. */
    enabled: boolean;
    payToAddress: string | undefined;
    priceUsd: string;
    network: string;
    asset: string | undefined;
    facilitatorUrl: string | undefined;
  };
}

export function loadConfig(): Config {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  return {
    port: envInt('PORT', 8080),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    service: {
      asp: 'KeepFlow',
      name: 'First Move — Ordered Incident Recovery',
      tagline: 'When life breaks, keep it moving.',
      version: '0.1.0',
    },
    classifier: {
      llmEnabled: Boolean(apiKey),
      apiKey,
      // Defaults to Opus 4.8. Set FIRSTMOVE_MODEL=claude-haiku-4-5 to cut
      // per-call cost — the classify/select task is simple enough for Haiku.
      model: process.env.FIRSTMOVE_MODEL?.trim() || 'claude-opus-4-8',
      timeoutMs: envInt('FIRSTMOVE_MODEL_TIMEOUT_MS', 6000),
    },
    resultCache: {
      ttlSeconds: envInt('RESULT_CACHE_TTL_SECONDS', 900),
    },
    payments: {
      enabled: envBool('PAYMENTS_ENABLED', false),
      payToAddress: process.env.X402_PAY_TO_ADDRESS?.trim() || undefined,
      priceUsd: process.env.X402_PRICE_USD?.trim() || '$0.20',
      // CAIP-2 network id. X Layer mainnet = eip155:196.
      network: process.env.X402_NETWORK?.trim() || 'eip155:196',
      // Optional settlement token contract; omit to let the facilitator resolve
      // the stablecoin from a `$`-prefixed price.
      asset: process.env.X402_ASSET?.trim() || undefined,
      facilitatorUrl: process.env.X402_FACILITATOR_URL?.trim() || undefined,
    },
  };
}

export const config = loadConfig();

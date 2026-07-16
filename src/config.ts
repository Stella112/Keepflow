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
  studyAssistant: {
    /** Grounded explanation is optional; deterministic source mapping remains available. */
    enabled: boolean;
    apiKey: string | undefined;
    model: string;
    timeoutMs: number;
  };
  research: {
    crossrefMailto: string | undefined;
    timeoutMs: number;
  };
  payments: {
    /** x402 pay-per-call via the OKX Payment SDK (@okxweb3/x402-express). */
    enabled: boolean;
    payToAddress: string | undefined;
    priceUsd: string;
    network: string;
    /** True when OKX facilitator creds (OKX_API_KEY/SECRET_KEY/PASSPHRASE) are
     *  present in the environment — the SDK reads them directly. */
    okxConfigured: boolean;
  };
}

export function loadConfig(): Config {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  return {
    port: envInt('PORT', 8080),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    service: {
      asp: 'KeepFlow',
      name: 'KeepFlow - Lifestyle Continuity Companion',
      tagline: 'The next safe step for everyday routines and life disruptions.',
      version: '0.3.0',
    },
    classifier: {
      llmEnabled: Boolean(apiKey),
      apiKey,
      // Defaults to Opus 4.8. Set FIRSTMOVE_MODEL=claude-haiku-4-5 to cut
      // per-call cost — the classify/select task is simple enough for Haiku.
      model: process.env.FIRSTMOVE_MODEL?.trim() || 'claude-opus-4-8',
      timeoutMs: envInt('FIRSTMOVE_MODEL_TIMEOUT_MS', 6000),
    },
    studyAssistant: {
      enabled: Boolean(apiKey) && envBool('STUDY_AI_ENABLED', true),
      apiKey,
      // Study Assist is intentionally cost-bounded at the five-cent price.
      model: process.env.STUDY_AI_MODEL?.trim() || 'claude-haiku-4-5',
      timeoutMs: envInt('STUDY_AI_TIMEOUT_MS', 25_000),
    },
    research: {
      crossrefMailto: process.env.CROSSREF_MAILTO?.trim() || undefined,
      timeoutMs: envInt('CROSSREF_TIMEOUT_MS', 8_000),
    },
    payments: {
      enabled: envBool('PAYMENTS_ENABLED', false),
      payToAddress:
        process.env.PAY_TO_ADDRESS?.trim() ||
        process.env.X402_PAY_TO_ADDRESS?.trim() ||
        undefined,
      priceUsd: process.env.X402_PRICE_USD?.trim() || '$0.05',
      // CAIP-2 network id. X Layer mainnet = eip155:196, testnet = eip155:1952.
      network: process.env.X402_NETWORK?.trim() || 'eip155:196',
      okxConfigured: Boolean(
        process.env.OKX_API_KEY?.trim() &&
          process.env.OKX_SECRET_KEY?.trim() &&
          process.env.OKX_PASSPHRASE?.trim(),
      ),
    },
  };
}

export const config = loadConfig();

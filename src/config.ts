/**
 * Central configuration. Reads from process.env with safe defaults so the
 * service runs out-of-the-box in deterministic-only mode (no API key, no
 * payments) and can be progressively enabled.
 */

function envInt(name: string, fallback: number, options: { min?: number; max?: number } = {}): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  // Number.parseInt('25junk', 10) silently accepts the prefix. Configuration
  // is security-sensitive (timeouts and listen ports), so require a complete
  // base-10 integer and keep it within the caller's safe bounds.
  if (!/^[+-]?\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return fallback;
  if (options.min !== undefined && n < options.min) return fallback;
  if (options.max !== undefined && n > options.max) return fallback;
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export interface Config {
  port: number;
  nodeEnv: string;
  publicBaseUrl: string;
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
  presentationAssistant: {
    /** Grounded deck planning is optional; deterministic rendering remains available. */
    enabled: boolean;
    apiKey: string | undefined;
    model: string;
    timeoutMs: number;
  };
  research: {
    crossrefMailto: string | undefined;
    timeoutMs: number;
  };
  contextRouting: {
    enabled: boolean;
    apiKey: string | undefined;
    timeoutMs: number;
    provider: 'google_maps';
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
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
  const configuredPayTo =
    process.env.PAY_TO_ADDRESS?.trim() ||
    process.env.X402_PAY_TO_ADDRESS?.trim() ||
    undefined;
  // KeepFlow's payment middleware uses the EVM exact scheme on X Layer. A
  // malformed destination would otherwise make the SDK throw during startup
  // (or, worse, advertise an unusable challenge). Treat it as unconfigured so
  // the app fails closed with an explicit 500 on paid routes.
  const payToAddress = configuredPayTo && /^0x[a-fA-F0-9]{40}$/.test(configuredPayTo)
    ? configuredPayTo
    : undefined;
  const configuredPrice = process.env.X402_PRICE_USD?.trim();
  // The SDK's USD price syntax is a dollar-prefixed decimal. Keep the amount
  // positive and bounded to cents; this prevents accidental free/astronomical
  // listings caused by a typo in deployment configuration.
  const priceUsd = configuredPrice && /^\$(?:0\.[0-9]{1,2}|[1-9]\d{0,5}(?:\.\d{1,2})?)$/.test(configuredPrice)
    && Number(configuredPrice.slice(1)) > 0
    ? configuredPrice
    : '$0.05';
  const configuredNetwork = process.env.X402_NETWORK?.trim();
  // ExactEvmScheme only supports CAIP-2 EVM namespaces. Limit the reference
  // to decimal chain IDs so a malformed value cannot reach the SDK.
  const network = configuredNetwork && /^eip155:\d{1,10}$/.test(configuredNetwork)
    && Number(configuredNetwork.slice('eip155:'.length)) > 0
    ? configuredNetwork
    : 'eip155:196';
  return {
    port: envInt('PORT', 8080, { min: 1, max: 65_535 }),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    publicBaseUrl: (process.env.PUBLIC_BASE_URL?.trim() || 'https://keepflow.site').replace(/\/+$/, ''),
    service: {
      asp: 'KeepFlow',
      name: 'KeepFlow - Lifestyle Continuity Companion',
      tagline: 'The next safe step for everyday routines and life disruptions.',
      version: '0.9.0',
    },
    classifier: {
      llmEnabled: Boolean(apiKey),
      apiKey,
      // Defaults to Opus 4.8. Set FIRSTMOVE_MODEL=claude-haiku-4-5 to cut
      // per-call cost — the classify/select task is simple enough for Haiku.
      model: process.env.FIRSTMOVE_MODEL?.trim() || 'claude-opus-4-8',
      timeoutMs: envInt('FIRSTMOVE_MODEL_TIMEOUT_MS', 6000, { min: 100, max: 120_000 }),
    },
    studyAssistant: {
      enabled: Boolean(apiKey) && envBool('STUDY_AI_ENABLED', true),
      apiKey,
      // Study Assist is intentionally cost-bounded at the five-cent price.
      model: process.env.STUDY_AI_MODEL?.trim() || 'claude-haiku-4-5',
      timeoutMs: envInt('STUDY_AI_TIMEOUT_MS', 25_000, { min: 100, max: 120_000 }),
    },
    presentationAssistant: {
      enabled: Boolean(apiKey) && envBool('PRESENTATION_AI_ENABLED', true),
      apiKey,
      model: process.env.PRESENTATION_AI_MODEL?.trim() || 'claude-haiku-4-5',
      timeoutMs: envInt('PRESENTATION_AI_TIMEOUT_MS', 25_000, { min: 100, max: 120_000 }),
    },
    research: {
      crossrefMailto: process.env.CROSSREF_MAILTO?.trim() || undefined,
      timeoutMs: envInt('CROSSREF_TIMEOUT_MS', 8_000, { min: 100, max: 120_000 }),
    },
    contextRouting: {
      enabled: envBool('CONTEXT_ROUTING_ENABLED', true),
      apiKey: googleMapsApiKey,
      timeoutMs: envInt('CONTEXT_ROUTING_TIMEOUT_MS', 8_000, { min: 500, max: 30_000 }),
      provider: 'google_maps',
    },
    payments: {
      enabled: envBool('PAYMENTS_ENABLED', false),
      payToAddress,
      priceUsd,
      // CAIP-2 network id. X Layer mainnet = eip155:196, testnet = eip155:1952.
      network,
      okxConfigured: Boolean(
        process.env.OKX_API_KEY?.trim() &&
          process.env.OKX_SECRET_KEY?.trim() &&
          process.env.OKX_PASSPHRASE?.trim(),
      ),
    },
  };
}

export const config = loadConfig();

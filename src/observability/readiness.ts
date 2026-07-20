import { OKXFacilitatorClient } from '@okxweb3/x402-core';
import type { Config } from '../config.js';
import { log } from './logger.js';

const READINESS_FRESH_MS = 2 * 60_000;
const PROBE_TIMEOUT_MS = 5_000;

function hasValidPaymentConfiguration(config: Config): boolean {
  return Boolean(
    config.payments.okxConfigured &&
      config.payments.payToAddress &&
      /^0x[a-fA-F0-9]{40}$/.test(config.payments.payToAddress) &&
      /^\$(?:0\.[0-9]{1,2}|[1-9]\d{0,5}(?:\.\d{1,2})?)$/.test(config.payments.priceUsd) &&
      Number(config.payments.priceUsd.slice(1)) > 0 &&
      /^eip155:\d{1,10}$/.test(config.payments.network) &&
      Number(config.payments.network.slice('eip155:'.length)) > 0,
  );
}

let lastCheckedAt: number | null = null;
let lastOkAt: number | null = null;
let paymentStatus: 'disabled' | 'unknown' | 'ok' | 'failed' = 'unknown';

export function readinessSnapshot(config: Config) {
  if (!config.payments.enabled) {
    return {
      ready: true,
      status: 'ready' as const,
      dependencies: { okx_facilitator: 'disabled' as const },
      last_checked_at: null,
    };
  }
  const ready = paymentStatus === 'ok' && lastOkAt !== null && Date.now() - lastOkAt <= READINESS_FRESH_MS;
  return {
    ready,
    status: ready ? 'ready' as const : 'not_ready' as const,
    dependencies: { okx_facilitator: paymentStatus },
    last_checked_at: lastCheckedAt === null ? null : new Date(lastCheckedAt).toISOString(),
  };
}

export async function refreshReadiness(config: Config): Promise<void> {
  if (!config.payments.enabled) {
    paymentStatus = 'disabled';
    return;
  }
  lastCheckedAt = Date.now();
  // A facilitator can be reachable while the seller destination is invalid.
  // Keep readiness honest because the app deliberately refuses to construct
  // the payment middleware without a validated EVM pay-to address.
  if (!hasValidPaymentConfiguration(config)) {
    paymentStatus = 'failed';
    log.warn('readiness.okx.failed', {
      reason: !config.payments.okxConfigured ? 'not_configured' : 'invalid_payment_configuration',
    });
    return;
  }
  const facilitator = new OKXFacilitatorClient({
    apiKey: process.env.OKX_API_KEY!,
    secretKey: process.env.OKX_SECRET_KEY!,
    passphrase: process.env.OKX_PASSPHRASE!,
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const supported = await Promise.race([
      facilitator.getSupported(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
      }),
    ]);
    const networkSupported = supported.kinds.some(
      (kind) => kind.network === config.payments.network && kind.scheme === 'exact',
    );
    if (!networkSupported) throw new Error('required_scheme_unavailable');
    paymentStatus = 'ok';
    lastOkAt = Date.now();
    log.info('readiness.okx.ok', { network: config.payments.network });
  } catch (error) {
    paymentStatus = 'failed';
    log.warn('readiness.okx.failed', {
      reason: error instanceof Error && error.message === 'timeout' ? 'timeout' : 'unavailable',
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

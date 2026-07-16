import type { RequestHandler } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@okxweb3/x402-express';
import { ExactEvmScheme } from '@okxweb3/x402-evm/exact/server';
import { OKXFacilitatorClient } from '@okxweb3/x402-core';
import type { Config } from '../config.js';
import { log } from '../observability/logger.js';

/**
 * OKX x402 pay-per-call, via the official @okxweb3/x402-express SDK.
 *
 * The SDK owns the whole payment lifecycle: it emits the 402 challenge
 * (base64 `PAYMENT-REQUIRED` header — JSON for API/SDK clients, an HTML paywall
 * only for browsers), verifies the presented `PAYMENT-SIG`, and settles on
 * X Layer. Credentials (OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE) are read
 * from the environment by the SDK; the resource server initializes against the
 * OKX facilitator on startup, which is why real credentials are required for
 * the endpoint to emit a 402 at all.
 *
 * Returns null when OKX isn't configured — the caller decides the fallback
 * (we fail closed rather than serve a paid route for free).
 */
export function createOkxPaymentMiddleware(config: Config): RequestHandler | null {
  if (!config.payments.okxConfigured || !config.payments.payToAddress) return null;

  // Safe: okxConfigured guarantees all three are present.
  const facilitator = new OKXFacilitatorClient({
    apiKey: process.env.OKX_API_KEY!,
    secretKey: process.env.OKX_SECRET_KEY!,
    passphrase: process.env.OKX_PASSPHRASE!,
  });
  const network = config.payments.network as `${string}:${string}`;
  const resourceServer = new x402ResourceServer(facilitator).register(
    network,
    new ExactEvmScheme(),
  );

  const middleware = paymentMiddleware(
    {
      'POST /v1/first-move': {
        accepts: {
          scheme: 'exact',
          price: config.payments.priceUsd,
          network,
          payTo: config.payments.payToAddress,
        },
        description: `${config.service.asp} - First Move - Ordered Incident Recovery`,
        mimeType: 'application/json',
      },
      'POST /v1/daily-flow': {
        accepts: {
          scheme: 'exact',
          price: config.payments.priceUsd,
          network,
          payTo: config.payments.payToAddress,
        },
        description: `${config.service.asp} - Daily Flow - Constraint-Aware Meal & Movement Checklist`,
        mimeType: 'application/json',
      },
    },
    resourceServer,
    // No browser paywall branding, no custom HTML — machine-to-machine ASP.
    undefined,
    undefined,
    // syncFacilitatorOnStart (default true): initialize supported schemes from
    // the OKX facilitator at startup so the 402 challenge can be built.
    true,
  );

  log.info('payments.okx.enabled', {
    network: config.payments.network,
    price: config.payments.priceUsd,
    payTo: config.payments.payToAddress,
  });

  return middleware as unknown as RequestHandler;
}

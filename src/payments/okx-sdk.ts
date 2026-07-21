import type { RequestHandler } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@okxweb3/x402-express';
import { ExactEvmScheme } from '@okxweb3/x402-evm/exact/server';
import { OKXFacilitatorClient } from '@okxweb3/x402-core';
import type { Config } from '../config.js';
import { log } from '../observability/logger.js';
import { PAID_ROUTE_SPECS } from './paid-routes.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { PaidRouteSpec } from './paid-routes.js';

/**
 * Describe the business request in the x402 challenge itself.
 *
 * OKX buyers use the Bazaar-compatible `outputSchema.input` declaration to
 * determine both the HTTP verb and how the original business parameters must
 * be carried on the paid replay.  An OpenAPI link on its own is useful to a
 * human, but it is not sufficient for an autonomous buyer to reconstruct a
 * nested POST body such as Continuity Pack's access profile.
 */
export function createX402RouteExtensions(
  route: PaidRouteSpec,
  publicBaseUrl: string,
): Record<string, unknown> {
  const bodySchema = zodToJsonSchema(route.inputSchema, {
    target: 'openApi3',
    $refStrategy: 'none',
  });

  return {
    outputSchema: {
      input: {
        type: 'http',
        method: route.method,
        bodyType: 'json',
        body: bodySchema,
      },
      output: {
        type: 'json',
      },
    },
    openapi: {
      url: `${publicBaseUrl}/openapi.json`,
      operationId: route.operationId,
    },
  };
}

/**
 * OKX x402 pay-per-call, via the official @okxweb3/x402-express SDK.
 *
 * The SDK owns the whole payment lifecycle: it emits the 402 challenge
 * (base64 `PAYMENT-REQUIRED` header — JSON for API/SDK clients, an HTML paywall
 * only for browsers), verifies the presented `PAYMENT-SIGNATURE`, and settles on
 * X Layer. Credentials (OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE) are read
 * from the environment by the SDK; the resource server initializes against the
 * OKX facilitator on startup, which is why real credentials are required for
 * the endpoint to emit a 402 at all.
 *
 * Returns null when OKX isn't configured — the caller decides the fallback
 * (we fail closed rather than serve a paid route for free).
 */
export function createOkxPaymentMiddleware(config: Config): RequestHandler | null {
  // Keep this guard defensive even though loadConfig validates these fields:
  // tests, embedding applications, and hot-reload code can supply a mutable
  // Config object directly.
  if (
    !config.payments.okxConfigured ||
    !config.payments.payToAddress ||
    !/^0x[a-fA-F0-9]{40}$/.test(config.payments.payToAddress) ||
    !/^\$(?:0\.[0-9]{1,2}|[1-9]\d{0,5}(?:\.\d{1,2})?)$/.test(config.payments.priceUsd) ||
    Number(config.payments.priceUsd.slice(1)) <= 0 ||
    !/^eip155:\d{1,10}$/.test(config.payments.network) ||
    Number(config.payments.network.slice('eip155:'.length)) <= 0
  ) return null;

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

  const paidRoutes = Object.fromEntries(
    PAID_ROUTE_SPECS.map((route) => [
      `${route.method} ${route.path}`,
      {
        accepts: {
          scheme: 'exact' as const,
          price: config.payments.priceUsd,
          network,
          payTo: config.payments.payToAddress!,
        },
        description: route.description,
        mimeType: 'application/json' as const,
        extensions: createX402RouteExtensions(route, config.publicBaseUrl),
      },
    ]),
  );

  const middleware = paymentMiddleware(
    paidRoutes,
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
    protected_routes: PAID_ROUTE_SPECS.length,
  });

  // x402-express exposes an async Express handler. Express 4 does not
  // propagate rejected handler promises to its error middleware, so an
  // facilitator outage or malformed payment could otherwise leave the
  // request hanging and produce an unhandled-rejection process warning.
  return ((req, res, next) => {
    Promise.resolve()
      .then(() => middleware(req, res, next))
      .catch((error: unknown) => {
        log.error('payments.middleware_error', {
          message: error instanceof Error ? error.message : 'unknown',
        });
        if (res.headersSent) {
          next(error);
          return;
        }
        res.status(503).json({ error: 'payment_service_unavailable' });
      });
  }) as RequestHandler;
}

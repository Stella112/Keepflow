import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { createFirstMoveRouter } from './routes/firstmove.js';
import { createDailyFlowRouter } from './routes/daily-flow.js';
import { studyFlowRouter } from './routes/study-flow.js';
import {
  createStudyAssistRouter,
  studyAssistPrepaymentGuard,
} from './routes/study-assist.js';
import type { StudyAssistDependencies } from './engine/study-assist.js';
import {
  workHandoverPrepaymentGuard,
  workHandoverRouter,
} from './routes/work-handover.js';
import { createOkxPaymentMiddleware } from './payments/okx-sdk.js';
import {
  findPaidRoute,
  isUnpaidX402DiscoveryProbe,
  rejectNonCanonicalPaidRouteAliases,
  validatePaidRequestBeforePayment,
} from './payments/paid-routes.js';
import { log } from './observability/logger.js';
import {
  reminderPackPrepaymentGuard,
  reminderPackRouter,
} from './routes/reminder-pack.js';
import {
  createPresentationPackRouter,
  presentationPackPrepaymentGuard,
} from './routes/presentation-pack.js';
import type { PresentationPlanner } from './engine/presentation-plan.js';
import {
  continuityPackPrepaymentGuard,
  createContinuityPackRouter,
} from './routes/continuity-pack.js';
import {
  createArtifactCapacityLimiter,
  createIdempotencyMiddleware,
  createPaidRouteRateLimiter,
} from './operational/limits.js';
import {
  createGoogleMapsProvider,
  type ContextRoutingProvider,
} from './context/google-maps-provider.js';
import { createContextEnrichmentAvailabilityGuard } from './context/enrichment-guard.js';
import { createModelClassifier } from './engine/model-classifier.js';

// Resolve bundled assets from the application location rather than the
// process working directory. PM2/systemd and container entrypoints may launch
// KeepFlow from another directory; the landing page must still load its CSS
// and logo in those deployments.
const PUBLIC_ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public',
);

export interface CreateAppOptions {
  /** Test/integration seam. Production uses the configured bounded providers. */
  studyAssistDependencies?: StudyAssistDependencies;
  /** Test/integration seam for grounded presentation planning. */
  presentationPlanner?: PresentationPlanner | null;
  /** Test/integration seam for consent-based live place and route discovery. */
  contextRoutingProvider?: ContextRoutingProvider;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const contextRoutingProvider = options.contextRoutingProvider ?? createGoogleMapsProvider({
    apiKey: config.contextRouting.enabled ? config.contextRouting.apiKey : undefined,
    timeoutMs: config.contextRouting.timeoutMs,
  });

  app.disable('x-powered-by');
  // KeepFlow is reached through exactly one trusted reverse-proxy hop (the
  // dedicated Cloudflare Tunnel connector). This lets Express honor
  // X-Forwarded-Proto, so the OKX x402 challenge binds to the caller-facing
  // HTTPS resource instead of the container's internal HTTP connection.
  app.set('trust proxy', 1);

  // Baseline response hardening for API, descriptor, and error responses. The
  // landing page adds a stricter CSP below; keeping these headers here ensures
  // JSON responses and parser errors receive the same browser protections.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Landing-page assets are the only cacheable public responses. API output
  // remains no-store below because it can reflect caller-provided context.
  app.use('/assets', express.static(PUBLIC_ASSETS_DIR, {
    dotfiles: 'deny',
    index: false,
    maxAge: '1h',
  }));
  // Modest body limit — descriptions are short free text.
  // Defensive: never cache responses (they may reflect a just-redacted input).
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Lightweight request log — method, path, status, latency ONLY. Never bodies.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      log.info('http', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        latency_ms: Date.now() - started,
      });
    });
    next();
  });

  app.use(healthRouter);

  // Express normally accepts case and trailing-slash variants, while x402
  // protects exact resource paths. Reject all paid-route aliases before any
  // route-specific guard so no spelling variant can reach a handler unpaid.
  app.use(rejectNonCanonicalPaidRouteAliases);
  app.use(createPaidRouteRateLimiter());

  // Study Assist accepts at most a 1 MiB PDF encoded as JSON base64. Only the
  // exact paid path gets the larger transport ceiling; every other route keeps
  // the original 64 KiB bound.
  const studyAssistJson = express.json({ limit: '1500kb' });
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path === '/v1/study-assist') {
      studyAssistJson(req, res, next);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  // OKX's A2MCP validator first probes a paid POST endpoint without business
  // parameters. Let only that empty, unsigned request reach x402 immediately,
  // so it receives PAYMENT-REQUIRED instead of an input-validation 400. Any
  // real request remains subject to the prepayment safety and schema guards
  // below. A paid replay with an empty body is not a probe and is rejected.
  const okxPayment = config.payments.enabled
    ? createOkxPaymentMiddleware(config)
    : null;
  if (config.payments.enabled) {
    app.use((req, res, next) => {
      if (!isUnpaidX402DiscoveryProbe(req)) {
        next();
        return;
      }
      if (!okxPayment) {
        log.warn('payments.misconfigured', {});
        res.status(500).json({ error: 'payment_misconfigured' });
        return;
      }
      okxPayment(req, res, next);
    });
  }

  // Existing services opt into real-world enrichment only when the caller
  // explicitly supplies one-request location permission. Never ask for x402
  // payment when that optional live dependency is not configured.
  app.use(createContextEnrichmentAvailabilityGuard(contextRoutingProvider));

  // Material is locally parsed, screened, masked and cleared before the
  // generic paid validator. External providers remain behind payment.
  app.post('/v1/study-assist', studyAssistPrepaymentGuard);

  // Work's raw nested credential/misuse scan must run before schema parsing
  // and before x402 so a prohibited handover never produces a payment prompt.
  app.post('/v1/work-handover', workHandoverPrepaymentGuard);

  // Reminder Pack rejects stale, malformed, or secret-bearing events before
  // payment and reuses the exact validated event set after settlement.
  app.post('/v1/reminder-pack', reminderPackPrepaymentGuard);

  // Presentation source items are screened, privacy-masked and held only in
  // server-owned response locals before the x402 payment challenge.
  app.post('/v1/presentation-pack', presentationPackPrepaymentGuard);

  // Continuity Pack turns validated, privacy-masked access context into one
  // executable response. Artifact generation remains behind successful x402.
  app.post('/v1/continuity-pack', continuityPackPrepaymentGuard);

  // Reject malformed, secret-bearing, or prohibited paid requests before the
  // customer sees an x402 challenge. Route handlers validate again as a
  // defense-in-depth boundary after payment verification.
  app.use(validatePaidRequestBeforePayment);
  app.use(createIdempotencyMiddleware());
  app.use(createArtifactCapacityLimiter());

  // Payments (x402 via the OKX SDK). Applied only to the paid route; /health
  // and / stay free. Off by default (pass-through). When enabled but OKX creds
  // are missing, fail closed on the paid route rather than serve it for free.
  if (config.payments.enabled) {
    if (okxPayment) {
      app.use(okxPayment);
    } else {
      app.use((req, res, next) => {
        if (findPaidRoute(req.method, req.path)) {
          log.warn('payments.misconfigured', {});
          res.status(500).json({ error: 'payment_misconfigured' });
          return;
        }
        next();
      });
    }
  }

  app.use(createFirstMoveRouter({
    classifier: createModelClassifier(config),
    contextRoutingProvider,
  }));
  app.use(createDailyFlowRouter(contextRoutingProvider));
  app.use(studyFlowRouter);
  app.use(createStudyAssistRouter(options.studyAssistDependencies));
  app.use(workHandoverRouter);
  app.use(reminderPackRouter);
  app.use(createPresentationPackRouter(options.presentationPlanner));
  app.use(createContinuityPackRouter(contextRoutingProvider));

  // JSON body parse errors and anything uncaught.
  app.use(
    (
      err: Error & { status?: number; type?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      if (err.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'invalid_json' });
        return;
      }
      if (err.type === 'entity.too.large' || err.status === 413) {
        res.status(413).json({ error: 'payload_too_large' });
        return;
      }
      log.error('unhandled', { message: err.message });
      res.status(500).json({ error: 'internal_error' });
    },
  );

  return app;
}

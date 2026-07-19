import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { firstMoveRouter } from './routes/firstmove.js';
import { dailyFlowRouter } from './routes/daily-flow.js';
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
  continuityPackRouter,
} from './routes/continuity-pack.js';

export interface CreateAppOptions {
  /** Test/integration seam. Production uses the configured bounded providers. */
  studyAssistDependencies?: StudyAssistDependencies;
  /** Test/integration seam for grounded presentation planning. */
  presentationPlanner?: PresentationPlanner | null;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  app.disable('x-powered-by');
  // KeepFlow is reached through exactly one trusted reverse-proxy hop (the
  // dedicated Cloudflare Tunnel connector). This lets Express honor
  // X-Forwarded-Proto, so the OKX x402 challenge binds to the caller-facing
  // HTTPS resource instead of the container's internal HTTP connection.
  app.set('trust proxy', 1);

  // Landing-page assets are the only cacheable public responses. API output
  // remains no-store below because it can reflect caller-provided context.
  app.use('/assets', express.static(path.resolve(process.cwd(), 'public'), {
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

  // Payments (x402 via the OKX SDK). Applied only to the paid route; /health
  // and / stay free. Off by default (pass-through). When enabled but OKX creds
  // are missing, fail closed on the paid route rather than serve it for free.
  if (config.payments.enabled) {
    const okxPayment = createOkxPaymentMiddleware(config);
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

  app.use(firstMoveRouter);
  app.use(dailyFlowRouter);
  app.use(studyFlowRouter);
  app.use(createStudyAssistRouter(options.studyAssistDependencies));
  app.use(workHandoverRouter);
  app.use(reminderPackRouter);
  app.use(createPresentationPackRouter(options.presentationPlanner));
  app.use(continuityPackRouter);

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

import express from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { firstMoveRouter } from './routes/firstmove.js';
import { createOkxPaymentMiddleware } from './payments/okx-sdk.js';
import { log } from './observability/logger.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Modest body limit — descriptions are short free text.
  app.use(express.json({ limit: '64kb' }));

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

  // Payments (x402 via the OKX SDK). Applied only to the paid route; /health
  // and / stay free. Off by default (pass-through). When enabled but OKX creds
  // are missing, fail closed on the paid route rather than serve it for free.
  if (config.payments.enabled) {
    const okxPayment = createOkxPaymentMiddleware(config);
    if (okxPayment) {
      app.use(okxPayment);
    } else {
      app.use((req, res, next) => {
        if (req.method === 'POST' && req.path === '/v1/first-move') {
          log.warn('payments.misconfigured', {});
          res.status(500).json({ error: 'payment_misconfigured' });
          return;
        }
        next();
      });
    }
  }

  app.use(firstMoveRouter);

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
      log.error('unhandled', { message: err.message });
      res.status(500).json({ error: 'internal_error' });
    },
  );

  return app;
}

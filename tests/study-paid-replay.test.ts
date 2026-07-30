import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { marketplacePaidReplayAdapter } from '../src/payments/marketplace-replay.js';
import {
  captureStudyReplayForChallenge,
  recoverStudyPaidReplay,
} from '../src/payments/study-replay.js';
import { validatePaidRequestBeforePayment } from '../src/payments/paid-routes.js';
import { createStudyRouter, studyServicePrepaymentGuard } from '../src/routes/study.js';

describe('Study paid request replay', () => {
  it('restores the exact validated geology request after an empty paid replay', async () => {
    const app = express();
    app.use(express.json());
    app.use(recoverStudyPaidReplay);
    app.use(marketplacePaidReplayAdapter);
    app.post('/v1/study', studyServicePrepaymentGuard);
    app.use(validatePaidRequestBeforePayment);
    app.use(captureStudyReplayForChallenge);
    app.use((req, res, next) => {
      if (req.headers['payment-signature']) {
        next();
        return;
      }
      res.status(402).json({ resource: req.originalUrl });
    });
    app.use(createStudyRouter({
      tutor: null,
      tutorModel: null,
      researchOptions: { timeoutMs: 1_000 },
    }));

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const origin = `http://127.0.0.1:${port}`;
      const quote = await fetch(`${origin}/v1/study`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'assist',
          request: {
            operation: 'practice_questions',
            subject: 'Geology',
            topic: 'Plate tectonics',
            learner_level: 'undergraduate',
            question: 'Create tertiary-level practice questions about plate boundaries.',
            output_language: 'English',
            depth: 'detailed',
            material: {
              type: 'text',
              title: 'Geology revision notes',
              content: 'Plate tectonics explains the movement of lithospheric plates. Divergent boundaries create new crust, convergent boundaries can cause subduction, and transform boundaries involve lateral movement.',
            },
            research: { enabled: false, max_sources: 3 },
            academic_integrity: { requested_action: 'generate_practice' },
            external_processing_acknowledged: true,
          },
        }),
      });
      expect(quote.status).toBe(402);
      const challenge = await quote.json() as { resource: string };
      expect(challenge.resource).toContain('_keepflow_replay=');
      expect(challenge.resource).not.toContain('Geology');
      expect(challenge.resource).not.toContain('tectonics');

      const paymentEnvelope = Buffer.from(JSON.stringify({
        x402Version: 2,
        resource: { url: `${origin}${challenge.resource}` },
        accepted: {},
        payload: {},
      })).toString('base64');
      const paid = await fetch(`${origin}/v1/study`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'PAYMENT-SIGNATURE': paymentEnvelope,
        },
        body: '{}',
      });
      expect(paid.status).toBe(200);
      const output = await paid.json() as Record<string, any>;
      expect(output.operation).toBe('practice_questions');
      expect(output.subject).toBe('Geology');
      expect(output.topic).toBe('Plate tectonics');
      expect(Array.isArray(output.practice_questions)).toBe(true);
      expect(output.service).not.toContain('Academic Execution');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

// Root landing — a small service descriptor so opening the bare domain in a
// browser shows what this is and how to call it, instead of "Cannot GET /".
healthRouter.get('/', (_req, res) => {
  res.json({
    asp: config.service.asp,
    service: config.service.name,
    tagline: config.service.tagline,
    version: config.service.version,
    description:
      'Ordered, cascade-aware digital-incident triage. Describe what went ' +
      'wrong and receive a structured recovery plan: what to do first, what ' +
      'it could compromise next, what to preserve, and what remains unknown. ' +
      'Procedural defensive guidance only — never asks for passwords, seed ' +
      'phrases, private keys, 2FA codes, or full card numbers.',
    endpoints: {
      health: 'GET /health',
      first_move: 'POST /v1/first-move  (JSON body: { "description": "..." })',
    },
    supported_incidents: [
      'stolen or lost phone',
      'account takeover',
      'lost or compromised 2FA',
      'possible seed phrase or private-key exposure',
    ],
    source: 'https://github.com/Stella112/Keepflow',
  });
});

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    asp: config.service.asp,
    service: config.service.name,
    version: config.service.version,
    tagline: config.service.tagline,
    classifier: config.classifier.llmEnabled ? 'hybrid' : 'deterministic',
    payments_enabled: config.payments.enabled,
  });
});

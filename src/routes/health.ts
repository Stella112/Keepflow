import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

// Root landing — a small service descriptor so opening the bare domain in a
// browser shows what this is and how to call it, instead of "Cannot GET /".
healthRouter.get('/', (_req, res) => {
  res.json({
    asp: config.service.asp,
    service: 'KeepFlow Agent Services',
    tagline: config.service.tagline,
    version: config.service.version,
    description:
      'Two stateless agent services: First Move provides ordered, cascade-aware ' +
      'digital-incident recovery; Daily Flow provides an adult general-wellness ' +
      'meal and movement checklist constrained by the caller-provided foods, ' +
      'allergies, access, budget preference, and international food context.',
    endpoints: {
      health: 'GET /health',
      first_move: 'POST /v1/first-move  (JSON body: { "description": "..." })',
      daily_flow: 'POST /v1/daily-flow  (JSON adult profile, constraints, and health screen)',
    },
    services: [
      'First Move - Ordered Incident Recovery',
      'Daily Flow - Constraint-Aware Meal & Movement Checklist',
    ],
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

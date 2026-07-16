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
      'A lifestyle continuity companion for everyday routines and disruptive ' +
      'moments: Daily Flow supports adult meal and movement routines; First Move ' +
      'orders digital-incident recovery; Study executes academic plans; and Work ' +
      'produces operational handovers.',
    endpoints: {
      health: 'GET /health',
      first_move: 'POST /v1/first-move  (JSON body: { "description": "..." })',
      daily_flow: 'POST /v1/daily-flow  (JSON adult profile, constraints, and health screen)',
      study_flow: 'POST /v1/study-flow  (JSON academic goal, tasks, availability, and constraints)',
      work_handover: 'POST /v1/work-handover  (JSON operational state, tasks, owners, and dependencies)',
    },
    services: [
      { priority: 1, name: 'Daily Flow - Constraint-Aware Meal & Movement Checklist' },
      { priority: 2, name: 'First Move - Ordered Incident Recovery' },
      { priority: 3, name: 'KeepFlow Study - Academic Execution' },
      { priority: 4, name: 'KeepFlow Work - Operational Handover' },
    ],
    first_move_supported_incidents: [
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
    service_count: 4,
  });
});

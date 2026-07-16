import { Router } from 'express';
import { config } from '../config.js';
import { landingPageHtml } from '../landing-page.js';

export const healthRouter = Router();

function buildServiceDescriptor() {
  return {
    asp: config.service.asp,
    service: config.service.name,
    tagline: config.service.tagline,
    version: config.service.version,
    study_tutor_mode: config.studyAssistant.enabled
      ? 'grounded_ai'
      : 'deterministic_source_map_fallback',
    description:
      'A lifestyle continuity companion for everyday routines and disruptive ' +
      'moments: Daily Flow supports adult meal and movement routines; First Move ' +
      'orders digital-incident recovery; Study executes academic plans and provides ' +
      'grounded learning, material explanation, and verified-source discovery; and ' +
      'Work produces operational handovers. Reminder Pack turns future actions from ' +
      'any service into importable calendar alerts without storing reminder data.',
    endpoints: {
      health: 'GET /health',
      service_descriptor: 'GET /service.json',
      first_move: 'POST /v1/first-move  (JSON body: { "description": "..." })',
      daily_flow: 'POST /v1/daily-flow  (JSON adult profile, constraints, and health screen)',
      study_flow: 'POST /v1/study-flow  (JSON academic goal, tasks, availability, and constraints)',
      study_assist: 'POST /v1/study-assist  (JSON study material or research query with explicit external-processing acknowledgement)',
      work_handover: 'POST /v1/work-handover  (JSON operational state, tasks, owners, and dependencies)',
      reminder_pack: 'POST /v1/reminder-pack  (JSON future events converted to importable calendar alarms)',
    },
    services: [
      { priority: 1, name: 'Daily Flow - Constraint-Aware Meal & Movement Checklist' },
      { priority: 2, name: 'First Move - Ordered Incident Recovery' },
      {
        priority: 3,
        name: 'KeepFlow Study - Academic Execution, Grounded Learning & Verified Research',
        capabilities: ['study planning', 'material explanation', 'practice support', 'source discovery'],
      },
      { priority: 4, name: 'KeepFlow Work - Operational Handover' },
    ],
    companion_capabilities: ['stateless calendar reminder packs with importable alerts'],
    first_move_supported_incidents: [
      'stolen or lost phone',
      'account takeover',
      'lost or compromised 2FA',
      'possible seed phrase or private-key exposure',
    ],
    source: 'https://github.com/Stella112/Keepflow',
  };
}

healthRouter.get('/', (_req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).type('html').send(landingPageHtml);
});

healthRouter.get('/service.json', (_req, res) => {
  res.json(buildServiceDescriptor());
});

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    asp: config.service.asp,
    service: config.service.name,
    version: config.service.version,
    tagline: config.service.tagline,
    classifier: config.classifier.llmEnabled ? 'hybrid' : 'deterministic',
    study_tutor_mode: config.studyAssistant.enabled
      ? 'grounded_ai'
      : 'deterministic_source_map_fallback',
    payments_enabled: config.payments.enabled,
    service_count: 4,
    paid_capability_count: 6,
    reminder_delivery_mode: 'calendar_import',
  });
});

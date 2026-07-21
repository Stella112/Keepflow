import { Router } from 'express';
import { config } from '../config.js';
import { landingPageHtml } from '../landing-page.js';
import { continuityMetricsSnapshot } from '../observability/continuity-metrics.js';
import { buildOpenApiDocument } from '../openapi.js';
import { readinessSnapshot } from '../observability/readiness.js';

export const healthRouter = Router();

function buildServiceDescriptor() {
  return {
    asp: config.service.asp,
    service: config.service.name,
    tagline: config.service.tagline,
    version: config.service.version,
    study_tutor_mode: config.studyAssistant.enabled
      ? 'grounded_ai_configured'
      : 'deterministic_source_map_fallback',
    presentation_planner_mode: config.presentationAssistant.enabled
      ? 'grounded_ai_configured'
      : 'deterministic_fallback',
    context_routing_mode: config.contextRouting.enabled && config.contextRouting.apiKey
      ? 'live_google_maps_configured'
      : 'unavailable_until_configured',
    description:
      'A lifestyle continuity companion for everyday routines and disruptive ' +
      'moments: Daily Flow supports adult meal and movement routines; First Move ' +
      'orders digital-incident recovery; Study executes academic plans and provides ' +
      'grounded learning, material explanation, and registry-verified source-metadata discovery; and ' +
      'Work produces operational handovers. Reminder Pack turns future actions from ' +
      'any service into importable calendar alerts without storing reminder data. ' +
      'Presentation Pack converts grounded Study or Work source material into a ' +
      'verified PowerPoint with speaker notes. Continuity Pack is the flagship ' +
      'orchestration capability: one access-aware request returns an action timeline, ' +
      'message scripts, delegation cards, calendar reminders, and PDF/DOCX briefs. ' +
      'Context & Routing is the shared real-world discovery layer: with explicit ' +
      'location permission, it ranks nearby places and provider routes while keeping ' +
      'unverified opening, safety, accessibility, allergy, and availability claims explicit.',
    endpoints: {
      health: 'GET /health',
      readiness: 'GET /ready',
      openapi: 'GET /openapi.json',
      service_descriptor: 'GET /service.json',
      first_move: 'POST /v1/first-move  (JSON body: { "description": "..." })',
      daily_flow: 'POST /v1/daily-flow  (JSON adult profile, constraints, and health screen)',
      study_flow: 'POST /v1/study-flow  (JSON academic goal, tasks, availability, and constraints)',
      study_assist: 'POST /v1/study-assist  (JSON study material or research query with explicit external-processing acknowledgement)',
      work_handover: 'POST /v1/work-handover  (JSON operational state, tasks, owners, and dependencies)',
      reminder_pack: 'POST /v1/reminder-pack  (JSON future events converted to importable calendar alarms)',
      presentation_pack: 'POST /v1/presentation-pack  (JSON grounded Work or Study source items converted to a verified PPTX)',
      continuity_pack: 'POST /v1/continuity-pack  (JSON disruption and resource availability converted to an executable PDF/DOCX/ICS continuity pack)',
      privacy_safe_metrics: 'GET /metrics  (process-lifetime aggregate counters; no request or artifact content)',
    },
    services: [
      { priority: 1, name: 'Daily Flow - Constraint-Aware Meal & Movement Checklist' },
      { priority: 2, name: 'First Move - Ordered Incident Recovery' },
      {
        priority: 3,
        name: 'KeepFlow Study - Academic Execution, Grounded Learning & Registry-Verified Research Metadata',
        capabilities: ['study planning', 'material explanation', 'practice support', 'source discovery', 'grounded presentations'],
      },
      {
        priority: 4,
        name: 'KeepFlow Work - Operational Handover',
        capabilities: ['operational handover', 'grounded executive presentations'],
      },
    ],
    companion_capabilities: [
      'flagship access-aware continuity orchestration with PDF, DOCX, and ICS artifacts',
      'stateless calendar reminder packs with importable alerts',
      'consent-based live place discovery embedded into relevant Daily Flow, First Move, and Continuity Pack responses',
    ],
    first_move_supported_incidents: [
      'stolen or lost phone',
      'account takeover',
      'lost or compromised 2FA',
      'possible seed phrase or private-key exposure',
    ],
    source: 'https://github.com/Stella112/Keepflow',
    openapi: `${config.publicBaseUrl}/openapi.json`,
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

healthRouter.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApiDocument());
});

healthRouter.get('/favicon.ico', (_req, res) => {
  res.redirect(308, '/assets/keepflow-logo.jpeg');
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
      ? 'grounded_ai_configured'
      : 'deterministic_source_map_fallback',
    presentation_planner_mode: config.presentationAssistant.enabled
      ? 'grounded_ai_configured'
      : 'deterministic_fallback',
    context_routing_mode: config.contextRouting.enabled && config.contextRouting.apiKey
      ? 'live_google_maps_configured'
      : 'unavailable_until_configured',
    payments_enabled: config.payments.enabled,
    service_count: 4,
    paid_capability_count: 8,
    reminder_delivery_mode: 'calendar_import',
  });
});

healthRouter.get('/ready', (_req, res) => {
  const snapshot = readinessSnapshot(config);
  res.status(snapshot.ready ? 200 : 503).json(snapshot);
});

healthRouter.get('/metrics', (_req, res) => {
  res.json({
    asp: config.service.asp,
    service: 'KeepFlow Continuity Pack',
    ...continuityMetricsSnapshot(),
  });
});

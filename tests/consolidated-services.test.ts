import express, { type Router } from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createDailyFlowRouter } from '../src/routes/daily-flow.js';
import { marketplacePaidGetReplayAdapter } from '../src/payments/marketplace-replay.js';
import { createStudyRouter } from '../src/routes/study.js';
import { workCareerRouter } from '../src/routes/work-career.js';
import type { ContextRoutingProvider } from '../src/context/google-maps-provider.js';

async function post(router: Router, path: string, body: unknown) {
  const app = express();
  app.use(express.json({ limit: '1500kb' }));
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function get(router: Router, path: string, body?: unknown) {
  const app = express();
  app.use(express.json({ limit: '1500kb' }));
  app.use(marketplacePaidGetReplayAdapter);
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const query = body === undefined
      ? ''
      : `?input=${encodeURIComponent(JSON.stringify(body))}`;
    const response = await fetch(`http://127.0.0.1:${port}${path}${query}`, {
      headers: { 'X-PAYMENT': 'test-paid-replay' },
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const unusedProvider: ContextRoutingProvider = {
  configured: false,
  search: async () => { throw new Error('not configured'); },
};

describe('consolidated KeepFlow services', () => {
  it('Daily serves a transparent starter plan when an OKX paid GET replay omits input', async () => {
    const result = await get(createDailyFlowRouter(unusedProvider), '/v1/daily-flow');
    expect(result.status).toBe(200);
    expect(result.body.service).toContain('Daily Flow');
    expect(result.body.meal_structure.breakfast.length).toBeGreaterThan(0);
    expect(result.body.assumptions[0]).toContain('marketplace replay supplied no personal inputs');
  });

  it('Daily accepts a personalized JSON body on an OKX GET replay', async () => {
    const result = await get(createDailyFlowRouter(unusedProvider), '/v1/daily-flow', {
      goal: 'maintain',
      profile: { age: 30, height_cm: 170, weight_kg: 70, activity_level: 'lightly_active' },
      constraints: {
        food_context_pack: 'china',
        available_foods: ['rice', 'tofu', 'bok choy', 'egg', 'orange'],
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.food_context_pack).toBe('china');
    expect(result.body.assumptions[0]).not.toContain('marketplace replay supplied no personal inputs');
  });

  it('Daily embeds an importable reminder calendar when scheduling is requested', async () => {
    const result = await post(createDailyFlowRouter(unusedProvider), '/v1/daily-flow', {
      goal: 'maintain',
      profile: { age: 30, height_cm: 170, weight_kg: 70, activity_level: 'lightly_active' },
      constraints: {
        food_context_pack: 'china',
        available_foods: ['rice', 'tofu', 'bok choy', 'egg', 'orange'],
        movement_access: 'walking_only',
        minutes_available: 30,
      },
      schedule: { timezone: 'Asia/Shanghai', starts_at: '2030-07-22T08:00:00+08:00', days: 3, movement_offset_minutes: 600 },
    });
    expect(result.status).toBe(200);
    expect(result.body.reminder_pack.event_count).toBe(6);
    expect(Buffer.from(result.body.reminder_pack.calendar_file.content_base64, 'base64').toString('utf8')).toContain('BEGIN:VCALENDAR');
  });

  it('Study turns an execution plan into sessions and calendar reminders in one call', async () => {
    const result = await post(createStudyRouter(), '/v1/study', {
      mode: 'plan',
      request: {
        goal: 'Prepare for the biology exam',
        planning_started_at: '2030-07-22T08:00:00+00:00',
        timezone: 'UTC',
        goal_deadline: '2030-07-24T18:00:00+00:00',
        tasks: [{ id: 'bio-review', subject: 'Biology', title: 'Review cell biology', kind: 'revision', importance: 'high', estimated_minutes: 90, due_at: '2030-07-24T12:00:00+00:00', materials: ['Course notes'], definition_of_done: 'All topics reviewed', evidence_of_done: 'Completed self-test' }],
        available_windows: [{ id: 'session-one', starts_at: '2030-07-22T10:00:00+00:00', minutes: 120 }],
        preferences: { preferred_session_minutes: 45, break_minutes: 10, energy_pattern: 'morning', internet_access: 'reliable', device_access: 'personal_computer', quiet_space: 'yes' },
        academic_integrity: { requested_action: 'plan_study', assessment_context: 'practice', collaboration_policy: 'open_resources' },
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.service).toBe('KeepFlow Study - Academic Execution');
    expect(result.body.sessions.length).toBeGreaterThan(0);
    expect(result.body.reminder_pack.event_count).toBe(result.body.sessions.length);
  });

  it('Study explains supplied material through the same public endpoint', async () => {
    const result = await post(createStudyRouter(), '/v1/study', {
      mode: 'assist',
      request: {
        operation: 'explain_material',
        subject: 'Biology',
        topic: 'Cellular respiration',
        learner_level: 'undergraduate',
        question: 'Explain how the main stages connect and what each stage contributes.',
        output_language: 'English',
        depth: 'detailed',
        material: {
          type: 'text',
          title: 'Course notes',
          content: 'Cellular respiration converts energy stored in glucose into ATP. Glycolysis occurs in the cytosol, while the citric acid cycle and oxidative phosphorylation occur in mitochondria. Electron carriers connect the stages.',
        },
        research: { enabled: false, max_sources: 4 },
        academic_integrity: { requested_action: 'learn_concepts' },
        external_processing_acknowledged: true,
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.operation).toBe('explain_material');
    expect(result.body.material_citations.length).toBeGreaterThan(0);
  });

  it('Work & Career produces truthful resume DOCX/PDF artifacts and transparent keyword analysis', async () => {
    const result = await post(workCareerRouter, '/v1/work-career', {
      mode: 'career',
      request: {
        target_role: 'Operations Manager',
        target_organization: 'Example Logistics',
        job_description: 'Lead logistics operations, improve reporting, manage stakeholders, and coordinate cross-functional delivery using spreadsheets and dashboards.',
        candidate: {
          name: 'KeepFlow Test User',
          professional_summary_facts: ['Operations coordinator with experience improving weekly reporting.'],
          skills: ['Logistics', 'Stakeholder management', 'Spreadsheets'],
          experience: [{ organization: 'Sample Distribution', role: 'Operations Coordinator', period: '2027–2030', achievements: ['Reduced weekly reporting preparation time by creating a reusable spreadsheet workflow.'] }],
          education: ['BSc Business Administration'],
        },
        preferences: { tone: 'direct', include_cover_letter: true, include_interview_prep: true },
        application_deadline: '2030-07-25T17:00:00+00:00',
        timezone: 'UTC',
        truthfulness_acknowledged: true,
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.meta.claims_invented).toBe(false);
    expect(result.body.artifacts.resume_docx.bytes).toBeGreaterThan(1_000);
    expect(result.body.artifacts.resume_pdf.bytes).toBeGreaterThan(1_000);
    expect(result.body.keyword_analysis.notice).toContain('not an ATS score');
    expect(result.body.reminders.event_count).toBe(1);
  });

  it('accepts the JSON-text request representation used by agent payment clients', async () => {
    const request = {
      target_role: 'Operations Coordinator',
      job_description: 'Coordinate schedules, document procedures, track dependencies, communicate status, and improve reliable team handovers.',
      candidate: {
        name: 'KeepFlow Test User',
        professional_summary_facts: ['Coordinated recurring operational tasks and documented repeatable workflows.'],
        skills: ['Operations coordination', 'Documentation'],
        experience: [{ organization: 'Independent Projects', role: 'Operations Coordinator', period: '2024-2026', achievements: ['Maintained action registers and delivery schedules.'] }],
      },
      truthfulness_acknowledged: true,
    };
    const result = await post(workCareerRouter, '/v1/work-career', {
      mode: 'career',
      request: JSON.stringify(request),
    });
    expect(result.status).toBe(200);
    expect(result.body.meta.claims_invented).toBe(false);
    expect(result.body.artifacts.resume_pdf.bytes).toBeGreaterThan(1_000);
  });

  it('accepts JSON-text Study requests from agent payment clients', async () => {
    const request = {
      goal: 'Prepare for the biology exam',
      planning_started_at: '2030-07-22T08:00:00+00:00',
      timezone: 'UTC',
      tasks: [{ id: 'bio-review', subject: 'Biology', title: 'Review cell biology', kind: 'revision' }],
      available_windows: [{ id: 'session-one', starts_at: '2030-07-22T10:00:00+00:00', minutes: 60 }],
      preferences: { preferred_session_minutes: 45, break_minutes: 10, energy_pattern: 'morning', internet_access: 'reliable', device_access: 'personal_computer', quiet_space: 'yes' },
    };
    const result = await post(createStudyRouter(), '/v1/study', {
      mode: 'plan',
      request: JSON.stringify(request),
    });
    expect(result.status).toBe(200);
    expect(result.body.sessions.length).toBeGreaterThan(0);
  });

  it('Work & Career preserves handover facts and adds reminders for future deadlines', async () => {
    const result = await post(workCareerRouter, '/v1/work-career', {
      mode: 'handover',
      request: {
        handover_title: 'Launch handover',
        objective: 'Keep the launch on schedule while the lead is away.',
        timezone: 'UTC',
        tasks: [{ id: 'launch-check', title: 'Verify launch checklist', owner: 'Release manager', status: 'in_progress', priority: 'high', next_action: 'Compare every item with the approved release checklist.', due_at: '2030-07-24T12:00:00+00:00', definition_of_done: 'Release manager signs the checklist.' }],
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.prioritized_items[0].owner).toBe('Release manager');
    expect(result.body.reminder_pack.event_count).toBe(1);
  });

  it('rejects fabricated career claims and credential-bearing input before work begins', async () => {
    const result = await post(workCareerRouter, '/v1/work-career', {
      mode: 'career',
      request: {
        target_role: 'Analyst',
        job_description: 'Analyze operational data and prepare accurate reports for leadership teams.',
        candidate: {
          name: 'Test User',
          professional_summary_facts: ['Analyst with reporting experience.'],
          skills: ['Reporting'],
          experience: [{ organization: 'Example', role: 'Analyst', period: '2029–2030', achievements: ['Password: hunter2'] }],
        },
        truthfulness_acknowledged: true,
      },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('sensitive_input_detected');
    expect(JSON.stringify(result.body)).not.toContain('hunter2');
  });
});

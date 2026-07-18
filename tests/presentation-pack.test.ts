import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  buildPresentationPack,
  inspectPresentationPptx,
} from '../src/engine/presentation-pack.js';
import {
  validatePresentationPlan,
  type PresentationPlan,
  type PresentationPlanner,
} from '../src/engine/presentation-plan.js';
import {
  createPresentationPackRouter,
  presentationPackPrepaymentGuard,
} from '../src/routes/presentation-pack.js';
import {
  PresentationPackInputSchema,
  type PresentationPackInput,
} from '../src/schemas/presentation-pack-input.js';

function workInput(overrides: Partial<PresentationPackInput> = {}): PresentationPackInput {
  return PresentationPackInputSchema.parse({
    domain: 'work',
    title: 'Project Northstar executive update',
    purpose: 'Give leadership a concise evidence-based status update and next decision.',
    audience: 'Senior leadership team',
    requested_slide_count: 5,
    source_items: [
      {
        id: 'E001',
        label: 'Delivery status',
        content: 'The design review is complete. The implementation milestone remains scheduled for 30 September. Two integration dependencies are still open.',
      },
      {
        id: 'E002',
        label: 'Decision required',
        content: 'Leadership must choose the support model before implementation can enter its final verification stage.',
      },
      {
        id: 'E003',
        label: 'Next actions',
        content: 'The delivery lead will confirm dependency owners. The operations lead will document the support model options.',
      },
    ],
    branding: {},
    external_processing_acknowledged: true,
    ...overrides,
  });
}

function validPlan(input: PresentationPackInput): PresentationPlan {
  return {
    communication_job: 'Help senior leadership choose the support model using the supplied project evidence.',
    deck_title: input.title,
    slides: [
      {
        kind: 'title',
        title: input.title,
        takeaway: 'A grounded update for the next leadership decision.',
        bullets: [],
        evidence_ids: [],
        speaker_notes: 'Open with the decision the audience needs to make.',
      },
      {
        kind: 'content',
        title: 'Delivery is progressing with two dependencies open',
        takeaway: 'The design review is complete and the implementation milestone remains scheduled.',
        bullets: ['Design review is complete.', 'Two integration dependencies remain open.'],
        evidence_ids: ['E001'],
        speaker_notes: 'State only the status recorded in E001.',
      },
      {
        kind: 'content',
        title: 'One leadership decision gates final verification',
        takeaway: 'The support model must be chosen before final verification.',
        bullets: ['Choose the support model.', 'Record the approved operating approach.'],
        evidence_ids: ['E002'],
        speaker_notes: 'Explain the decision requirement recorded in E002.',
      },
      {
        kind: 'content',
        title: 'Named follow-ups close the remaining gaps',
        takeaway: 'Delivery and operations leads have distinct next actions.',
        bullets: ['Confirm dependency owners.', 'Document support model options.'],
        evidence_ids: ['E003'],
        speaker_notes: 'Use E003 for both action statements.',
      },
      {
        kind: 'closing',
        title: 'Choose the support model to protect the milestone',
        takeaway: 'Resolve the documented decision before final verification begins.',
        bullets: [],
        evidence_ids: ['E002'],
        speaker_notes: 'Close on the grounded decision and avoid adding a deadline.',
      },
    ],
  };
}

async function postToRouter(body: unknown, planner: PresentationPlanner | null = null) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.post('/v1/presentation-pack', presentationPackPrepaymentGuard);
  app.use(createPresentationPackRouter(planner));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/v1/presentation-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('Presentation Pack schemas and plan validation', () => {
  it('requires unique evidence ids and an academic-integrity declaration for Study', () => {
    expect(PresentationPackInputSchema.safeParse({
      ...workInput(),
      domain: 'study',
      academic_integrity: undefined,
    }).success).toBe(false);

    expect(PresentationPackInputSchema.safeParse({
      ...workInput(),
      source_items: [workInput().source_items[0], workInput().source_items[0]],
    }).success).toBe(false);
  });

  it('rejects unknown evidence ids and malformed narrative structure', () => {
    const input = workInput();
    const plan = validPlan(input);
    plan.slides[1]!.evidence_ids = ['E999'];
    plan.slides[2]!.kind = 'closing';
    const result = validatePresentationPlan(plan, input, input.source_items);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('unknown evidence id: E999');
    expect(result.errors).toContain('middle slide 3 must be content');
  });
});

describe('Presentation Pack renderer', () => {
  it('creates a verified PPTX with all slides and speaker notes', async () => {
    const input = workInput();
    const { output, inspection } = await buildPresentationPack(input, null);
    expect(output.generation_mode).toBe('deterministic_fallback');
    expect(output.slide_count).toBe(input.requested_slide_count);
    expect(output.presentation_file.byte_length).toBeGreaterThan(20_000);
    expect(output.quality).toMatchObject({
      schema_validated: true,
      archive_validated: true,
      evidence_references_validated: true,
      speaker_notes_slide_count: input.requested_slide_count,
    });

    const bytes = Buffer.from(output.presentation_file.content_base64, 'base64');
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(await inspectPresentationPptx(bytes, input.requested_slide_count)).toEqual(inspection);
  });

  it('uses a valid grounded planner result and records grounded_ai mode', async () => {
    const input = workInput();
    const planner: PresentationPlanner = {
      async plan() {
        return validPlan(input);
      },
    };
    const { output } = await buildPresentationPack(input, planner);
    expect(output.generation_mode).toBe('grounded_ai');
    expect(output.presentation_file.filename).toBe('project-northstar-executive-update.pptx');
  });
});

describe('Presentation Pack HTTP capability', () => {
  it('serves a real stateless presentation through the standalone route', async () => {
    const { response, body } = await postToRouter(workInput());
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      service: 'KeepFlow Presentation Pack - Grounded Slide Creation',
      domain: 'work',
      slide_count: 5,
      meta: { stateless: true, stores_files: false },
    });
  });

  it('rejects secrets before generation without echoing them', async () => {
    const secret = 'api_key=live_customer_service_token_123456789';
    const input = workInput();
    input.source_items[0]!.content += ` ${secret}`;
    const { response, body } = await postToRouter(input);
    expect(response.status).toBe(400);
    expect(body.error).toBe('sensitive_data_detected');
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it('blocks assessed-submission and learner-impersonation requests before generation', async () => {
    const base = {
      ...workInput(),
      domain: 'study' as const,
      academic_integrity: { requested_action: 'learn_concepts' as const },
      purpose: 'Write my graded assignment and make the presentation ready to submit.',
    };
    const { response, body } = await postToRouter(base);
    expect(response.status).toBe(403);
    expect(body.error).toBe('academic_integrity_redirect');
  });

  it('masks direct contact identifiers before planning and reports the categories', async () => {
    const input = workInput();
    input.source_items[0]!.content += ' Contact: student@example.com.';
    const { response, body } = await postToRouter(input);
    expect(response.status).toBe(200);
    expect(body.personal_data_masked).toContain('email');
    expect(JSON.stringify(body)).not.toContain('student@example.com');
  });
});

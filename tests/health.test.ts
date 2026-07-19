import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

async function withApp<T>(run: (origin: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('KeepFlow service descriptors', () => {
  it('serves the branded landing page and supplied logo without weakening its headers', async () => {
    await withApp(async (origin) => {
      const response = await fetch(`${origin}/`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(body).toContain('When life shifts,');
      expect(body).toContain('DAILY FLOW');
      expect(body).toContain('FIRST MOVE');
      expect(body).toContain('KEEPFLOW STUDY');
      expect(body).toContain('KEEPFLOW WORK');
      expect(body).toContain('Calendar Reminder Pack');
      expect(body).toContain('CONTINUITY PACK');
      expect(body).toContain('No phone');
      expect(body).toContain('<span>PDF</span><span>DOCX</span><span>ICS</span>');
      expect(body).toContain('/assets/keepflow-logo.jpeg');
      expect(body).toContain('0.05 USDT');

      const logo = await fetch(`${origin}/assets/keepflow-logo.jpeg`);
      expect(logo.status).toBe(200);
      expect(logo.headers.get('content-type')).toContain('image/jpeg');
      expect(Number(logo.headers.get('content-length'))).toBeGreaterThan(20_000);
    });
  });

  it('advertises shared capabilities while retaining four core services', async () => {
    await withApp(async (origin) => {
      const response = await fetch(`${origin}/service.json`);
      const body = await response.json() as {
        version: string;
        study_tutor_mode: string;
        endpoints: Record<string, string>;
        companion_capabilities: string[];
        services: Array<{ priority: number; name: string; capabilities?: string[] }>;
      };

      expect(response.status).toBe(200);
      expect(body.version).toBe('0.7.0');
      expect(body.endpoints.study_assist).toContain('POST /v1/study-assist');
      expect(body.endpoints.reminder_pack).toContain('POST /v1/reminder-pack');
      expect(body.endpoints.presentation_pack).toContain('POST /v1/presentation-pack');
      expect(body.endpoints.continuity_pack).toContain('POST /v1/continuity-pack');
      expect(body.endpoints.privacy_safe_metrics).toContain('GET /metrics');
      expect(body.companion_capabilities).toContain(
        'flagship access-aware continuity orchestration with PDF, DOCX, and ICS artifacts',
      );
      expect(body.companion_capabilities).toContain(
        'stateless calendar reminder packs with importable alerts',
      );
      expect(body.services).toHaveLength(4);
      expect(body.services.filter((service) => service.name.includes('KeepFlow Study')))
        .toHaveLength(1);
      expect(body.services.find((service) => service.priority === 3)?.capabilities)
        .toContain('material explanation');
      expect(body.study_tutor_mode).toBe(
        config.studyAssistant.enabled
          ? 'grounded_ai'
          : 'deterministic_source_map_fallback',
      );
    });
  });

  it('reports the tutor mode without increasing the core-service count', async () => {
    await withApp(async (origin) => {
      const response = await fetch(`${origin}/health`);
      const body = await response.json() as {
        status: string;
        version: string;
        service_count: number;
        paid_capability_count: number;
        reminder_delivery_mode: string;
        study_tutor_mode: string;
      };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: 'ok',
        version: '0.7.0',
        service_count: 4,
        paid_capability_count: 8,
        reminder_delivery_mode: 'calendar_import',
        study_tutor_mode: config.studyAssistant.enabled
          ? 'grounded_ai'
          : 'deterministic_source_map_fallback',
      });
    });
  });

  it('exposes only aggregate Continuity Pack metrics', async () => {
    await withApp(async (origin) => {
      const response = await fetch(`${origin}/metrics`);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.service).toBe('KeepFlow Continuity Pack');
      expect(body).toHaveProperty('successful_paid_packs');
      expect(body).toHaveProperty('failed_generation_attempts');
      expect(body).toHaveProperty('generated_artifacts');
      expect(body).not.toHaveProperty('description');
      expect(body).not.toHaveProperty('messages');
      expect(body).not.toHaveProperty('request_body');
    });
  });
});

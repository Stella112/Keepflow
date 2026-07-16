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
  it('advertises Study Assist as part of Study while retaining four core services', async () => {
    await withApp(async (origin) => {
      const response = await fetch(`${origin}/`);
      const body = await response.json() as {
        version: string;
        study_tutor_mode: string;
        endpoints: Record<string, string>;
        services: Array<{ priority: number; name: string; capabilities?: string[] }>;
      };

      expect(response.status).toBe(200);
      expect(body.version).toBe('0.3.0');
      expect(body.endpoints.study_assist).toContain('POST /v1/study-assist');
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
        study_tutor_mode: string;
      };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: 'ok',
        version: '0.3.0',
        service_count: 4,
        study_tutor_mode: config.studyAssistant.enabled
          ? 'grounded_ai'
          : 'deterministic_source_map_fallback',
      });
    });
  });
});

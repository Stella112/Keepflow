import { describe, expect, it } from 'vitest';
import {
  PAID_ROUTE_SPECS,
  X402_DISCOVERY_ROUTE_SPECS,
} from '../src/payments/paid-routes.js';
import {
  createX402RouteExtensions,
  createX402UnpaidResponseBody,
} from '../src/payments/okx-sdk.js';

describe('OKX x402 discovery metadata', () => {
  it('declares a replayable JSON POST body for every paid route', () => {
    for (const route of PAID_ROUTE_SPECS) {
      const extensions = createX402RouteExtensions(route, 'https://keepflow.site') as {
        outputSchema: {
          input: {
            type: string;
            method: string;
            bodyType: string;
            body: { type?: string; properties?: Record<string, unknown>; required?: string[] };
          };
          output: { type: string };
        };
        openapi: { url: string; operationId: string };
      };

      expect(extensions.outputSchema.input.type).toBe('http');
      expect(extensions.outputSchema.input.method).toBe('POST');
      expect(extensions.outputSchema.input.bodyType).toBe('json');
      expect(extensions.outputSchema.input.body.type).toBe('object');
      expect(extensions.outputSchema.input.body.properties).toBeDefined();
      expect(extensions.outputSchema.output.type).toBe('json');
      expect(extensions.openapi).toEqual({
        url: 'https://keepflow.site/openapi.json',
        operationId: route.operationId,
      });
    }
  });

  it('publishes the complete required Continuity Pack request contract', () => {
    const route = PAID_ROUTE_SPECS.find((candidate) => candidate.path === '/v1/continuity-pack');
    expect(route).toBeDefined();

    const extensions = createX402RouteExtensions(route!, 'https://keepflow.site') as {
      outputSchema: {
        input: {
          body: { properties: Record<string, unknown>; required: string[] };
        };
      };
    };
    const body = extensions.outputSchema.input.body;

    expect(body.required).toEqual(expect.arrayContaining([
      'situation_type',
      'description',
      'location',
      'access',
      'timezone',
    ]));
    expect(body.properties.location).toBeDefined();
    expect(body.properties.access).toBeDefined();
  });

  it('advertises POST replay semantics from every OKX GET discovery alias', () => {
    expect(X402_DISCOVERY_ROUTE_SPECS).toHaveLength(PAID_ROUTE_SPECS.length);
    for (const route of X402_DISCOVERY_ROUTE_SPECS) {
      const extensions = createX402RouteExtensions(route, 'https://keepflow.site') as {
        outputSchema: { input: { method: string; bodyType: string } };
      };

      expect(route.method).toBe('GET');
      expect(extensions.outputSchema.input.method).toBe('POST');
      expect(extensions.outputSchema.input.bodyType).toBe('json');
    }
  });

  it('keeps replay metadata suitable for both top-level and payment-option publication', () => {
    for (const route of PAID_ROUTE_SPECS) {
      const metadata = createX402RouteExtensions(route, 'https://keepflow.site') as {
        outputSchema: { input: { method: string; body: { required?: string[] } } };
        openapi: { operationId: string };
      };

      expect(metadata.outputSchema.input.method).toBe('POST');
      expect(metadata.outputSchema.input.body.required?.length).toBeGreaterThan(0);
      expect(metadata.openapi.operationId).toBe(route.operationId);
    }
  });

  it('publishes required business fields in the unpaid JSON compatibility body', () => {
    const route = PAID_ROUTE_SPECS.find((candidate) => candidate.path === '/v1/first-move');
    expect(route).toBeDefined();

    const response = createX402UnpaidResponseBody(route!);
    expect(response.contentType).toBe('application/json');
    expect(response.body.required).toEqual(['description']);
    expect(response.body.inputSchema).toMatchObject({
      type: 'object',
      properties: { description: { type: 'string' } },
    });
  });
});

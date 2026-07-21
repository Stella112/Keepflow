import { describe, expect, it } from 'vitest';
import {
  PAID_ROUTE_SPECS,
  X402_DISCOVERY_ROUTE_SPECS,
} from '../src/payments/paid-routes.js';
import { createX402RouteExtensions } from '../src/payments/okx-sdk.js';

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

  it('advertises POST replay semantics from the OKX GET discovery alias', () => {
    const route = X402_DISCOVERY_ROUTE_SPECS[0];
    const extensions = createX402RouteExtensions(route, 'https://keepflow.site') as {
      outputSchema: { input: { method: string; bodyType: string } };
    };

    expect(route.method).toBe('GET');
    expect(extensions.outputSchema.input.method).toBe('POST');
    expect(extensions.outputSchema.input.bodyType).toBe('json');
  });
});

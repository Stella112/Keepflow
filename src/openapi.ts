import { zodToJsonSchema } from 'zod-to-json-schema';
import { config } from './config.js';
import { PAID_ROUTE_SPECS } from './payments/paid-routes.js';

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: true,
} as const;

function requestSchema(route: (typeof PAID_ROUTE_SPECS)[number]) {
  const converted = zodToJsonSchema(route.inputSchema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

export function buildOpenApiDocument() {
  const paths = Object.fromEntries(PAID_ROUTE_SPECS.map((route) => [
    route.path,
    {
      post: {
        operationId: route.operationId,
        summary: route.description,
        description: 'Paid agent-to-agent capability. Validate the request locally, then follow the HTTP 402 payment challenge. Reuse a unique Idempotency-Key when retrying the same request.',
        tags: ['Paid capabilities'],
        parameters: [{
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description: 'Unique 24-128 character retry key. A key is bound to one validated request body for 15 minutes.',
          schema: { type: 'string', minLength: 24, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
        }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: requestSchema(route) } },
        },
        responses: {
          '200': { description: 'Schema-validated KeepFlow result.' },
          '400': { description: 'Malformed, unsafe, or unsupported request.', content: { 'application/json': { schema: errorSchema } } },
          '402': { description: 'Payment required. Read the PAYMENT-REQUIRED response header.' },
          '409': { description: 'Idempotency key was already used with a different validated request.' },
          '429': { description: 'Request-rate limit reached. Retry after the indicated interval.' },
          '503': { description: 'A required dependency or bounded artifact worker is temporarily unavailable.' },
        },
      },
    },
  ]));

  return {
    openapi: '3.1.0',
    info: {
      title: 'KeepFlow Agent Service API',
      version: config.service.version,
      description: 'Machine-readable contracts for KeepFlow\'s paid lifestyle-continuity capabilities.',
    },
    servers: [{ url: config.publicBaseUrl }],
    paths,
  };
}

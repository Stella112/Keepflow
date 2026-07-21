import { z } from 'zod';
import { ContextPlaceCategorySchema } from './context-routing-input.js';

const RouteSchema = z
  .object({
    mode: z.enum(['walking', 'driving', 'bicycling', 'transit']),
    distance_m: z.number().int().nonnegative(),
    duration_seconds: z.number().int().nonnegative(),
    safety_verified: z.literal(false),
    warning: z.string().min(1),
  })
  .strict();

const PlaceSchema = z
  .object({
    rank: z.number().int().positive(),
    place_id: z.string().min(1),
    name: z.string().min(1),
    category: ContextPlaceCategorySchema,
    matched_provider_types: z.array(z.string().min(1)),
    address: z.string().min(1),
    location: z.object({ latitude: z.number(), longitude: z.number() }).strict(),
    straight_line_distance_m: z.number().int().nonnegative(),
    opening_status: z.enum(['open', 'closed', 'unknown']),
    business_status: z.enum(['operational', 'closed_temporarily', 'closed_permanently', 'unknown']),
    provider_url: z.string().url(),
    route: RouteSchema.nullable(),
    ranking_reasons: z.array(z.string().min(1)).min(1),
    confirmed_facts: z.array(z.string().min(1)).min(1),
    unverified_facts: z.array(z.string().min(1)).min(1),
    accessibility_status: z.literal('unverified'),
    allergy_safety: z.literal('unverified'),
  })
  .strict();

export const ContextRoutingOutputSchema = z
  .object({
    service: z.literal('KeepFlow Context & Routing - Real-World Discovery'),
    source_service: z.enum(['daily_flow', 'first_move', 'continuity_pack', 'study', 'work', 'other']),
    query_summary: z.string().min(1),
    location_use: z
      .object({
        permission_received: z.literal(true),
        precision: z.literal('caller_supplied_coordinates'),
        stored: z.literal(false),
      })
      .strict(),
    results: z.array(PlaceSchema).max(8),
    emergency_notice: z.string().min(1).nullable(),
    provider: z
      .object({
        name: z.literal('Google Maps Platform'),
        retrieved_at: z.string().datetime(),
        attribution: z.string().min(1),
      })
      .strict(),
    limitations: z.array(z.string().min(1)).min(1),
    meta: z
      .object({
        asp: z.literal('KeepFlow'),
        schema_version: z.literal('1.0.0'),
        generated_at: z.string().datetime(),
        stores_location_data: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type ContextRoutingOutput = z.infer<typeof ContextRoutingOutputSchema>;

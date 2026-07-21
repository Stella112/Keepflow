import { z } from 'zod';

export const ContextPlaceCategorySchema = z.enum([
  'restaurant',
  'hospital',
  'police_station',
  'embassy_or_consulate',
  'hotel',
  'bank',
  'mobile_network_store',
  'pharmacy',
  'transit_station',
]);

const ContextOriginSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

const ContextSearchOptionsShape = {
  radius_m: z.number().int().min(100).max(20_000).default(3_000),
  max_results: z.number().int().min(1).max(8).default(5),
  travel_mode: z.enum(['walking', 'driving', 'bicycling', 'transit']).default('walking'),
  language_code: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).default('en'),
  region_code: z.string().regex(/^[A-Z]{2}$/).optional(),
  prefer_open_now: z.boolean().default(true),
  budget: z.enum(['low', 'moderate', 'flexible', 'not_applicable']).default('not_applicable'),
  allergies: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  accessibility_needs: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  urgency: z.enum(['routine', 'soon', 'urgent', 'immediate']).default('routine'),
} as const;

/** Optional field embedded in an existing KeepFlow service request. The active
 * service determines categories and the practical need; the caller supplies
 * only consent, coordinates, and constraints. */
export const ContextEnrichmentRequestSchema = z
  .object({
    location_permission: z.literal(true),
    origin: ContextOriginSchema,
    search: z.object(ContextSearchOptionsShape).strict().default({}),
  })
  .strict();

export const ContextRoutingInputSchema = z
  .object({
    source_service: z.enum(['daily_flow', 'first_move', 'continuity_pack', 'study', 'work', 'other']),
    need: z.string().trim().min(10).max(500),
    /** The calling user must deliberately permit this one request to use location. */
    location_permission: z.literal(true),
    origin: ContextOriginSchema,
    search: z
      .object({
        categories: z.array(ContextPlaceCategorySchema).min(1).max(4),
        ...ContextSearchOptionsShape,
      })
      .strict(),
  })
  .strict();

export type ContextRoutingInput = z.infer<typeof ContextRoutingInputSchema>;
export type ContextPlaceCategory = z.infer<typeof ContextPlaceCategorySchema>;
export type ContextEnrichmentRequest = z.infer<typeof ContextEnrichmentRequestSchema>;

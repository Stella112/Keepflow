import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import {
  ContextProviderError,
  createGoogleMapsProvider,
  type ContextRoutingProvider,
} from '../src/context/google-maps-provider.js';
import { buildContextRouting } from '../src/engine/context-routing.js';
import { ContextRoutingInputSchema } from '../src/schemas/context-routing-input.js';
import { ContextRoutingOutputSchema } from '../src/schemas/context-routing-output.js';

const requestBody = {
  source_service: 'first_move' as const,
  need: 'Find a staffed place where a traveller can safely ask for help.',
  location_permission: true as const,
  origin: { latitude: 6.5244, longitude: 3.3792 },
  search: {
    categories: ['hotel', 'police_station'] as const,
    radius_m: 3000,
    max_results: 3,
    travel_mode: 'walking' as const,
    prefer_open_now: true,
    allergies: [],
    accessibility_needs: ['step-free entrance'],
    urgency: 'urgent' as const,
  },
};

function fakeProvider(): ContextRoutingProvider {
  return {
    name: 'Google Maps Platform',
    configured: true,
    discover: vi.fn(async (input) => input.source_service === 'daily_flow' ? [{
      placeId: 'daily-restaurant',
      name: 'Example Restaurant',
      address: '4 Example Road, Lagos',
      latitude: 6.525,
      longitude: 3.38,
      types: ['restaurant'],
      category: 'restaurant',
      openNow: true,
      businessStatus: 'OPERATIONAL',
      providerUrl: 'https://maps.google.com/?cid=4',
      route: { distanceM: 350, durationSeconds: 240 },
    }] : [
      {
        placeId: 'near-closed',
        name: 'Nearby Hotel',
        address: '1 Example Road, Lagos',
        latitude: 6.5245,
        longitude: 3.3793,
        types: ['hotel', 'lodging'],
        category: 'hotel',
        openNow: false,
        businessStatus: 'OPERATIONAL',
        providerUrl: 'https://maps.google.com/?cid=1',
        route: { distanceM: 100, durationSeconds: 80 },
      },
      {
        placeId: 'open-police',
        name: 'Central Police Station',
        address: '2 Example Road, Lagos',
        latitude: 6.526,
        longitude: 3.381,
        types: ['police'],
        category: 'police_station',
        openNow: true,
        businessStatus: 'OPERATIONAL',
        providerUrl: 'https://maps.google.com/?cid=2',
        route: { distanceM: 500, durationSeconds: 360 },
      },
    ]),
  };
}

async function withApp<T>(app: ReturnType<typeof createApp>, run: (origin: string) => Promise<T>) {
  const server = app.listen(0, '127.0.0.1');
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

describe('Context & Routing engine', () => {
  it('returns schema-valid sourced results and ranks a provider-reported open place first', async () => {
    const input = ContextRoutingInputSchema.parse(requestBody);
    const output = await buildContextRouting(input, fakeProvider());

    expect(ContextRoutingOutputSchema.safeParse(output).success).toBe(true);
    expect(output.results.map((place) => place.place_id)).toEqual(['open-police', 'near-closed']);
    expect(output.results[0]?.route).toMatchObject({ safety_verified: false, mode: 'walking' });
    expect(output.results[0]?.unverified_facts.join(' ')).toContain('step-free entrance');
    expect(output.location_use).toEqual({
      permission_received: true,
      precision: 'caller_supplied_coordinates',
      stored: false,
    });
  });

  it('never treats immediate discovery as emergency dispatch', async () => {
    const input = ContextRoutingInputSchema.parse({
      ...requestBody,
      search: { ...requestBody.search, urgency: 'immediate' },
    });
    const output = await buildContextRouting(input, fakeProvider());
    expect(output.emergency_notice).toContain('not emergency dispatch');
  });
});

describe('Google Maps provider adapter', () => {
  it('fails locally without a key and never contacts the provider', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const provider = createGoogleMapsProvider({ apiKey: undefined, timeoutMs: 1000 });
      await expect(provider.discover(ContextRoutingInputSchema.parse(requestBody)))
        .rejects.toEqual(new ContextProviderError('not_configured'));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses bounded Google Places and Routes requests and normalizes their facts', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        places: [{
          id: 'provider-place',
          displayName: { text: 'Example Hotel' },
          formattedAddress: '3 Example Road, Lagos',
          location: { latitude: 6.525, longitude: 3.38 },
          types: ['hotel', 'lodging'],
          currentOpeningHours: { openNow: true },
          businessStatus: 'OPERATIONAL',
          googleMapsUri: 'https://maps.google.com/?cid=3',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        routes: [{ duration: '420s', distanceMeters: 750 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const provider = createGoogleMapsProvider({ apiKey: 'server-only-key', timeoutMs: 1000 });
      const places = await provider.discover(ContextRoutingInputSchema.parse(requestBody));
      expect(places).toHaveLength(1);
      expect(places[0]).toMatchObject({
        category: 'hotel',
        openNow: true,
        route: { distanceM: 750, durationSeconds: 420 },
      });

      const [placesUrl, placesOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(placesUrl).toBe('https://places.googleapis.com/v1/places:searchNearby');
      expect((placesOptions.headers as Record<string, string>)['x-goog-fieldmask'])
        .not.toContain('*');
      const placesBody = JSON.parse(String(placesOptions.body)) as any;
      expect(placesBody.maxResultCount).toBe(3);
      expect(placesBody.locationRestriction.circle.radius).toBe(3000);

      const [routesUrl, routesOptions] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(routesUrl).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
      const routesBody = JSON.parse(String(routesOptions.body)) as any;
      expect(routesBody.travelMode).toBe('WALK');
      expect(routesBody.computeAlternativeRoutes).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Context & Routing HTTP boundary', () => {
  const realWorldContext = {
    location_permission: true,
    origin: requestBody.origin,
    search: {
      radius_m: 3000,
      max_results: 3,
      travel_mode: 'walking',
      prefer_open_now: true,
      accessibility_needs: ['step-free entrance'],
      urgency: 'urgent',
    },
  };

  const dailyRequest = {
    goal: 'maintain',
    profile: {
      age: 32,
      height_cm: 168,
      weight_kg: 68,
      sex_for_energy_equation: 'female',
      activity_level: 'lightly_active',
    },
    constraints: {
      food_context_pack: 'nigeria',
      allergies: ['peanut'],
      available_foods: ['rice', 'beans', 'spinach', 'egg'],
    },
    health_screen: {},
    real_world_context: realWorldContext,
  };

  it('has no separate Context & Routing endpoint', async () => {
    await withApp(createApp({ contextRoutingProvider: fakeProvider() }), async (origin) => {
      const response = await fetch(`${origin}/v1/context-routing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      expect(response.status).toBe(404);
    });
  });

  it('embeds nearby restaurant results inside one Daily Flow response', async () => {
    const provider = fakeProvider();
    await withApp(createApp({ contextRoutingProvider: provider }), async (origin) => {
      const response = await fetch(`${origin}/v1/daily-flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dailyRequest),
      });
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.service).toContain('Daily Flow');
      expect(body.context_routing.source_service).toBe('daily_flow');
      expect(body.context_routing.results[0]).toMatchObject({ category: 'restaurant' });
      expect(provider.discover).toHaveBeenCalledOnce();
      expect(provider.discover).toHaveBeenCalledWith(expect.objectContaining({
        search: expect.objectContaining({
          categories: ['restaurant'],
          allergies: ['peanut'],
          budget: 'moderate',
          urgency: 'routine',
        }),
      }));
    });
  });

  it('embeds relevant staffed support inside one First Move response', async () => {
    const provider = fakeProvider();
    await withApp(createApp({ contextRoutingProvider: provider }), async (origin) => {
      const response = await fetch(`${origin}/v1/first-move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: 'My phone and wallet were stolen while travelling alone.',
          real_world_context: realWorldContext,
        }),
      });
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.incident_type).toBe('stolen_or_lost_phone');
      expect(body.context_routing.source_service).toBe('first_move');
      expect(body.context_routing.results.length).toBeGreaterThan(0);
      expect(provider.discover).toHaveBeenCalledOnce();
      expect(provider.discover).toHaveBeenCalledWith(expect.objectContaining({
        search: expect.objectContaining({
          categories: ['police_station', 'hotel', 'bank', 'mobile_network_store'],
          urgency: 'urgent',
        }),
      }));
    });
  });

  it('embeds real-world support inside one Continuity Pack response', async () => {
    const provider = fakeProvider();
    await withApp(createApp({ contextRoutingProvider: provider }), async (origin) => {
      const response = await fetch(`${origin}/v1/continuity-pack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          situation_type: 'stolen_phone_or_wallet',
          description: 'My phone and wallet were stolen while travelling alone.',
          location: { country: 'Nigeria', city_or_area: 'Lagos', away_from_home: true },
          access: {
            safe_place: 'available',
            another_device: 'unavailable',
            borrowed_phone: 'available',
            internet: 'available',
            money: 'unavailable',
            identification: 'unknown',
            trusted_person: 'available',
            transport: 'available',
          },
          stakeholders: ['bank_or_card_provider', 'mobile_carrier', 'police_or_local_authority'],
          immediate_deadlines: [],
          timezone: 'Africa/Lagos',
          real_world_context: realWorldContext,
        }),
      });
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.service).toContain('Continuity Pack');
      expect(body.context_routing.source_service).toBe('continuity_pack');
      expect(body.context_routing.results.length).toBeGreaterThan(0);
      expect(body.artifacts.printable_brief.byte_length).toBeGreaterThan(0);
      expect(provider.discover).toHaveBeenCalledOnce();
      expect(provider.discover).toHaveBeenCalledWith(expect.objectContaining({
        source_service: 'continuity_pack',
        search: expect.objectContaining({ urgency: 'urgent' }),
      }));
    });
  });

  it('rejects missing consent before any provider call', async () => {
    const provider = fakeProvider();
    await withApp(createApp({ contextRoutingProvider: provider }), async (origin) => {
      const response = await fetch(`${origin}/v1/daily-flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...dailyRequest,
          real_world_context: { ...realWorldContext, location_permission: false },
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_request' });
      expect(provider.discover).not.toHaveBeenCalled();
    });
  });

  it('fails the existing service before payment when requested enrichment is not configured', async () => {
    const provider: ContextRoutingProvider = {
      name: 'Google Maps Platform',
      configured: false,
      discover: vi.fn(async () => []),
    };
    await withApp(createApp({ contextRoutingProvider: provider }), async (origin) => {
      const response = await fetch(`${origin}/v1/daily-flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dailyRequest),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'context_routing_unavailable' });
      expect(provider.discover).not.toHaveBeenCalled();
    });
  });
});

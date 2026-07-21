import type { ContextRoutingProvider, ProviderPlace } from '../context/google-maps-provider.js';
import type { ContextRoutingInput } from '../schemas/context-routing-input.js';
import { ContextRoutingOutputSchema, type ContextRoutingOutput } from '../schemas/context-routing-output.js';

function radians(value: number): number {
  return value * Math.PI / 180;
}
function distanceMeters(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): number {
  const earthRadiusM = 6_371_000;
  const deltaLatitude = radians(destination.latitude - origin.latitude);
  const deltaLongitude = radians(destination.longitude - origin.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(origin.latitude)) * Math.cos(radians(destination.latitude)) *
    Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function businessStatus(status: ProviderPlace['businessStatus']) {
  if (status === 'OPERATIONAL') return 'operational' as const;
  if (status === 'CLOSED_TEMPORARILY') return 'closed_temporarily' as const;
  if (status === 'CLOSED_PERMANENTLY') return 'closed_permanently' as const;
  return 'unknown' as const;
}

function routeWarning(mode: ContextRoutingInput['search']['travel_mode']): string {
  if (mode === 'walking' || mode === 'bicycling') {
    return 'Provider route only; paths or sidewalks may be incomplete. Check current conditions and personal safety before travelling.';
  }
  return 'Provider route only. KeepFlow has not verified traffic, service disruption, personal safety, or accessibility along this route.';
}

function score(place: ProviderPlace, input: ContextRoutingInput): number {
  const distance = place.route?.distanceM ?? distanceMeters(input.origin, place);
  const openBoost = input.search.prefer_open_now && place.openNow === true ? -100_000 : 0;
  const closedPenalty = place.businessStatus === 'CLOSED_PERMANENTLY' ? 1_000_000 :
    place.businessStatus === 'CLOSED_TEMPORARILY' ? 500_000 : 0;
  return distance + openBoost + closedPenalty;
}

export async function buildContextRouting(
  input: ContextRoutingInput,
  provider: ContextRoutingProvider,
): Promise<ContextRoutingOutput> {
  const retrievedAt = new Date().toISOString();
  const discovered = await provider.discover(input);
  const ranked = [...discovered]
    .filter((place) => place.businessStatus !== 'CLOSED_PERMANENTLY')
    .sort((left, right) => score(left, input) - score(right, input))
    .slice(0, input.search.max_results);

  const output: ContextRoutingOutput = {
    service: 'KeepFlow Context & Routing - Real-World Discovery',
    source_service: input.source_service,
    query_summary: `${input.need} (${input.search.categories.join(', ')})`,
    location_use: {
      permission_received: true,
      precision: 'caller_supplied_coordinates',
      stored: false,
    },
    results: ranked.map((place, index) => {
      const straightLineDistance = distanceMeters(input.origin, place);
      const openingStatus = place.openNow === true ? 'open' : place.openNow === false ? 'closed' : 'unknown';
      const rankingReasons = [
        `Matches requested category: ${place.category}.`,
        place.route
          ? `${place.route.distanceM} m by the requested provider route.`
          : `${straightLineDistance} m straight-line distance; routed distance unavailable.`,
      ];
      if (input.search.prefer_open_now && place.openNow === true) {
        rankingReasons.push('Provider reported it open at retrieval time.');
      }
      return {
        rank: index + 1,
        place_id: place.placeId,
        name: place.name,
        category: place.category,
        matched_provider_types: place.types,
        address: place.address,
        location: { latitude: place.latitude, longitude: place.longitude },
        straight_line_distance_m: straightLineDistance,
        opening_status: openingStatus,
        business_status: businessStatus(place.businessStatus),
        provider_url: place.providerUrl,
        route: place.route ? {
          mode: input.search.travel_mode,
          distance_m: place.route.distanceM,
          duration_seconds: place.route.durationSeconds,
          safety_verified: false,
          warning: routeWarning(input.search.travel_mode),
        } : null,
        ranking_reasons: rankingReasons,
        confirmed_facts: [
          'Place name, category, address, and coordinates were returned by the named provider at retrieval time.',
          ...(place.openNow === null ? [] : [`Provider reported the place ${place.openNow ? 'open' : 'closed'} at retrieval time.`]),
        ],
        unverified_facts: [
          place.openNow === null
            ? 'Current opening status is unknown; contact the place or check the provider listing before travelling.'
            : 'Opening status can change after retrieval; confirm before travelling.',
          'Staffing, queues, service availability, prices, and suitability for this specific need are not verified.',
          input.search.accessibility_needs.length
            ? `Requested accessibility needs (${input.search.accessibility_needs.join(', ')}) are not verified.`
            : 'Accessibility has not been verified.',
          input.search.allergies.length
            ? `Allergy safety for ${input.search.allergies.join(', ')} is not verified; contact the venue and check cross-contact controls.`
            : 'Food-allergy safety has not been verified.',
        ],
        accessibility_status: 'unverified',
        allergy_safety: 'unverified',
      };
    }),
    emergency_notice: input.search.urgency === 'immediate'
      ? 'If anyone is in immediate danger or needs urgent medical help, contact local emergency services or ask nearby trusted staff to do so now. This discovery result is not emergency dispatch.'
      : null,
    provider: {
      name: provider.name,
      retrieved_at: retrievedAt,
      attribution: 'Place and route data: Google Maps Platform.',
    },
    limitations: [
      'Results are ranked by requested category, provider route or straight-line distance, reported opening status, and business status—not by guaranteed suitability.',
      'KeepFlow does not guarantee opening hours, staffing, stock, allergy safety, accessibility, prices, or route safety.',
      'Caller-supplied coordinates are used for this response and are not intentionally persisted by KeepFlow.',
    ],
    meta: {
      asp: 'KeepFlow',
      schema_version: '1.0.0',
      generated_at: new Date().toISOString(),
      stores_location_data: false,
    },
  };

  return ContextRoutingOutputSchema.parse(output);
}

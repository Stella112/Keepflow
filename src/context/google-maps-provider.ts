import type {
  ContextPlaceCategory,
  ContextRoutingInput,
} from '../schemas/context-routing-input.js';

export interface ProviderRoute {
  distanceM: number;
  durationSeconds: number;
}
export interface ProviderPlace {
  placeId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  types: string[];
  category: ContextPlaceCategory;
  openNow: boolean | null;
  businessStatus: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | null;
  providerUrl: string;
  route: ProviderRoute | null;
}

export interface ContextRoutingProvider {
  readonly name: 'Google Maps Platform';
  readonly configured: boolean;
  discover(input: ContextRoutingInput): Promise<ProviderPlace[]>;
}

export class ContextProviderError extends Error {
  constructor(public readonly code: 'not_configured' | 'timeout' | 'unavailable') {
    super(code);
  }
}

const GOOGLE_TYPES: Record<ContextPlaceCategory, readonly string[]> = {
  restaurant: ['restaurant', 'cafe', 'meal_takeaway'],
  hospital: ['hospital', 'general_hospital', 'medical_center'],
  police_station: ['police', 'neighborhood_police_station'],
  embassy_or_consulate: ['embassy'],
  hotel: ['hotel', 'lodging', 'hostel'],
  bank: ['bank'],
  mobile_network_store: ['cell_phone_store', 'telecommunications_service_provider'],
  pharmacy: ['pharmacy', 'drugstore'],
  transit_station: ['transit_station', 'bus_station', 'subway_station', 'train_station'],
};

const TRAVEL_MODE = {
  walking: 'WALK',
  driving: 'DRIVE',
  bicycling: 'BICYCLE',
  transit: 'TRANSIT',
} as const;

interface GooglePlace {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  types?: unknown;
  currentOpeningHours?: { openNow?: unknown };
  businessStatus?: unknown;
  googleMapsUri?: unknown;
}

function numeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function categoryFor(types: string[], requested: ContextPlaceCategory[]): ContextPlaceCategory | null {
  return requested.find((category) => GOOGLE_TYPES[category].some((type) => types.includes(type))) ?? null;
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Math.max(0, Math.round(Number(match[1]))) : null;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ContextProviderError('unavailable');
  }
  return data as Record<string, unknown>;
}

export function createGoogleMapsProvider(options: {
  apiKey: string | undefined;
  timeoutMs: number;
}): ContextRoutingProvider {
  const { apiKey, timeoutMs } = options;

  return {
    name: 'Google Maps Platform',
    configured: Boolean(apiKey),
    async discover(input) {
      if (!apiKey) throw new ContextProviderError('not_configured');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const includedTypes = [...new Set(input.search.categories.flatMap((category) => GOOGLE_TYPES[category]))];
        const placesResponse = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey,
            'x-goog-fieldmask': [
              'places.id',
              'places.displayName',
              'places.formattedAddress',
              'places.location',
              'places.types',
              'places.currentOpeningHours',
              'places.businessStatus',
              'places.googleMapsUri',
            ].join(','),
          },
          body: JSON.stringify({
            includedTypes,
            maxResultCount: input.search.max_results,
            rankPreference: 'DISTANCE',
            languageCode: input.search.language_code,
            ...(input.search.region_code ? { regionCode: input.search.region_code } : {}),
            locationRestriction: {
              circle: {
                center: input.origin,
                radius: input.search.radius_m,
              },
            },
          }),
        });
        const placesData = await responseJson(placesResponse);
        const candidates = Array.isArray(placesData.places) ? placesData.places as GooglePlace[] : [];

        const normalized = candidates.flatMap((place): Omit<ProviderPlace, 'route'>[] => {
          const types = Array.isArray(place.types)
            ? place.types.filter((type): type is string => typeof type === 'string')
            : [];
          const category = categoryFor(types, input.search.categories);
          const latitude = place.location?.latitude;
          const longitude = place.location?.longitude;
          const name = place.displayName?.text;
          if (
            !category || typeof place.id !== 'string' || typeof name !== 'string' ||
            typeof place.formattedAddress !== 'string' || !numeric(latitude) || !numeric(longitude) ||
            typeof place.googleMapsUri !== 'string'
          ) return [];
          const rawBusiness = place.businessStatus;
          const businessStatus = rawBusiness === 'OPERATIONAL' || rawBusiness === 'CLOSED_TEMPORARILY' || rawBusiness === 'CLOSED_PERMANENTLY'
            ? rawBusiness
            : null;
          return [{
            placeId: place.id,
            name,
            address: place.formattedAddress,
            latitude,
            longitude,
            types,
            category,
            openNow: typeof place.currentOpeningHours?.openNow === 'boolean'
              ? place.currentOpeningHours.openNow
              : null,
            businessStatus,
            providerUrl: place.googleMapsUri,
          }];
        });

        return await Promise.all(normalized.map(async (place): Promise<ProviderPlace> => {
          try {
            const routeResponse = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'content-type': 'application/json',
                'x-goog-api-key': apiKey,
                'x-goog-fieldmask': 'routes.duration,routes.distanceMeters',
              },
              body: JSON.stringify({
                origin: { location: { latLng: input.origin } },
                destination: { location: { latLng: { latitude: place.latitude, longitude: place.longitude } } },
                travelMode: TRAVEL_MODE[input.search.travel_mode],
                computeAlternativeRoutes: false,
                languageCode: input.search.language_code,
                units: 'METRIC',
              }),
            });
            const routeData = await responseJson(routeResponse);
            const route = Array.isArray(routeData.routes) ? routeData.routes[0] as Record<string, unknown> | undefined : undefined;
            const durationSeconds = parseDurationSeconds(route?.duration);
            const distanceM = route?.distanceMeters;
            return {
              ...place,
              route: numeric(distanceM) && durationSeconds !== null
                ? { distanceM: Math.round(distanceM), durationSeconds }
                : null,
            };
          } catch (error) {
            if (controller.signal.aborted) throw error;
            return { ...place, route: null };
          }
        }));
      } catch (error) {
        if (error instanceof ContextProviderError) throw error;
        if (controller.signal.aborted) throw new ContextProviderError('timeout');
        throw new ContextProviderError('unavailable');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

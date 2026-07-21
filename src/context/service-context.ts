import type { IncidentType } from '../schemas/firstmove-output.js';
import type { ContinuityPackInput } from '../schemas/continuity-pack-input.js';
import {
  ContextRoutingInputSchema,
  type ContextEnrichmentRequest,
  type ContextPlaceCategory,
  type ContextRoutingInput,
} from '../schemas/context-routing-input.js';

export function contextInputForService(options: {
  sourceService: ContextRoutingInput['source_service'];
  need: string;
  request: ContextEnrichmentRequest;
  categories: ContextPlaceCategory[];
}): ContextRoutingInput {
  return ContextRoutingInputSchema.parse({
    source_service: options.sourceService,
    need: options.need,
    location_permission: options.request.location_permission,
    origin: options.request.origin,
    search: {
      ...options.request.search,
      categories: options.categories.slice(0, 4),
    },
  });
}

export function firstMoveCategories(incident: IncidentType): ContextPlaceCategory[] {
  if (incident === 'stolen_or_lost_phone') {
    return ['police_station', 'hotel', 'bank', 'mobile_network_store'];
  }
  if (incident === 'account_takeover') return ['bank', 'police_station'];
  if (incident === 'lost_authenticator') return ['mobile_network_store'];
  return [];
}

export function continuityCategories(input: ContinuityPackInput): ContextPlaceCategory[] {
  const categories = new Set<ContextPlaceCategory>();
  const bySituation: Partial<Record<ContinuityPackInput['situation_type'], ContextPlaceCategory[]>> = {
    stolen_phone_or_wallet: ['police_station', 'hotel', 'bank', 'mobile_network_store'],
    lost_documents: ['police_station', 'embassy_or_consulate', 'hotel'],
    travel_disruption: ['transit_station', 'hotel'],
    account_access_disruption: ['bank', 'mobile_network_store'],
    home_disruption: ['hotel'],
  };
  (bySituation[input.situation_type] ?? []).forEach((category) => categories.add(category));

  for (const stakeholder of input.stakeholders) {
    if (stakeholder === 'bank_or_card_provider') categories.add('bank');
    if (stakeholder === 'mobile_carrier') categories.add('mobile_network_store');
    if (stakeholder === 'embassy_or_consulate') categories.add('embassy_or_consulate');
    if (stakeholder === 'police_or_local_authority') categories.add('police_station');
    if (stakeholder === 'accommodation_or_transport') {
      categories.add('hotel');
      categories.add('transit_station');
    }
  }
  return [...categories].slice(0, 4);
}

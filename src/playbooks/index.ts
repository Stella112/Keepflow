import type { IncidentType } from '../schemas/firstmove-output.js';
import type { Runbook } from './types.js';
import { accountTakeover } from './account-takeover.js';
import { lostAuthenticator } from './lost-authenticator.js';
import { seedKeyExposure } from './seed-key-exposure.js';
import { stolenPhone } from './stolen-phone.js';

/** All curated runbooks for supported incident types (excludes `unknown`). */
export const RUNBOOKS: readonly Runbook[] = [
  stolenPhone,
  accountTakeover,
  lostAuthenticator,
  seedKeyExposure,
];

const BY_TYPE = new Map<IncidentType, Runbook>(
  RUNBOOKS.map((r) => [r.incidentType, r]),
);

export function getRunbook(type: IncidentType): Runbook | undefined {
  return BY_TYPE.get(type);
}

/** The runbook used for detected secret/seed exposure (deterministic path). */
export const EXPOSURE_RUNBOOK = seedKeyExposure;

export type { Runbook } from './types.js';

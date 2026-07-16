import {
  ResearchSourceRequestSchema,
  buildOfficialResearchPortals,
  type ResearchSourceRequest,
  type ResearchSourceResult,
  type VerifiedResearchSource,
} from './source-provider.js';

const CROSSREF_WORKS_URL = 'https://api.crossref.org/v1/works';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RESPONSE_BYTE_LIMIT = 512 * 1024;
const MAX_RESPONSE_BYTE_LIMIT = 1024 * 1024;
const MAX_RETRY_DELAY_MS = 500;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export type CrossrefFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CrossrefFetchOptions {
  fetchImpl?: CrossrefFetch;
  /** Testable clock for the verification timestamp only. */
  now?: () => Date;
  /** Always clamped to 8 seconds or less. */
  timeoutMs?: number;
  /** Always clamped to 1 MiB or less. */
  responseByteLimit?: number;
  /** Optional operator contact; never sourced from a student request. */
  contactEmail?: string;
  /** Injectable to make the single bounded retry deterministic in tests. */
  sleep?: (milliseconds: number) => Promise<void>;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeHtmlEntities(input: string): string {
  return input.replace(
    /&(?:amp|lt|gt|quot|apos|#39|#x[0-9a-f]{1,6}|#[0-9]{1,7});/gi,
    (entity) => {
      const lower = entity.toLowerCase();
      const named: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&#39;': "'",
      };
      if (named[lower] !== undefined) return named[lower];

      const hexadecimal = /^&#x([0-9a-f]+);$/i.exec(entity);
      const decimal = /^&#([0-9]+);$/.exec(entity);
      const codePoint = hexadecimal
        ? Number.parseInt(hexadecimal[1]!, 16)
        : decimal
          ? Number.parseInt(decimal[1]!, 10)
          : Number.NaN;
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return '';
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return '';
      }
    },
  );
}

/** Convert provider text to safe, plain Unicode without changing its meaning. */
export function normalizeProviderText(value: unknown): string {
  if (typeof value !== 'string') return '';

  // Two passes handle common double-encoded markup without attempting to be a
  // general-purpose HTML parser. Markup is removed after decoding so encoded
  // tags cannot survive as active HTML in a downstream interface.
  let text = decodeHtmlEntities(decodeHtmlEntities(value));
  text = text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();
  return text;
}

function normalizeDoi(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const doi = value
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');

  if (
    doi.length === 0 ||
    doi.length > 512 ||
    !/^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(doi) ||
    /[\u0000-\u0020\u007f-\u009f]/u.test(doi)
  ) {
    return null;
  }
  return doi;
}

function encodeDoiPath(doi: string): string {
  return doi
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

function firstText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return normalizeProviderText(value[0]);
}

function authorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const given = normalizeProviderText(entry.given);
    const family = normalizeProviderText(entry.family);
    const name = [given, family].filter(Boolean).join(' ');
    if (name) names.push(name);
  }
  return names;
}

function issuedYear(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const parts = value['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const year = parts[0][0];
  return Number.isInteger(year) && Number(year) >= 1500 && Number(year) <= 2100
    ? Number(year)
    : null;
}

function mapCrossrefItem(
  item: unknown,
  verifiedAt: string,
): VerifiedResearchSource | null {
  if (!isRecord(item)) return null;
  const doi = normalizeDoi(item.DOI);
  const title = firstText(item.title);
  if (!doi || !title || doi.length > 200 || title.length > 500) return null;
  // Source discovery is for papers a student can evaluate, not correction,
  // retraction, or supplemental-material records that can rank highly because
  // they share a parent article's vocabulary.
  if (
    /(?:\.supp|\/supp(?:lement)?)$/i.test(doi) ||
    /^(?:supplemental\s+material|correction|corrigendum|erratum|retraction)\b/iu.test(title)
  ) {
    return null;
  }

  const canonicalUrl = `https://doi.org/${encodeDoiPath(doi)}`;
  if (canonicalUrl.length > 300) return null;
  const venueValue = firstText(item['container-title']);
  const publisherValue = normalizeProviderText(item.publisher);
  const typeValue = normalizeProviderText(item.type);

  return {
    provider: 'crossref',
    provider_id: doi,
    doi,
    title,
    authors: authorNames(item.author)
      .filter((name) => name.length <= 160)
      .slice(0, 30),
    issued_year: issuedYear(item.issued),
    venue: venueValue && venueValue.length <= 300 ? venueValue : null,
    publisher: publisherValue && publisherValue.length <= 300 ? publisherValue : null,
    work_type: typeValue && typeValue.length <= 100 ? typeValue : 'journal-article',
    canonical_url: canonicalUrl,
    verification_status: 'crossref_registry_record_found',
    integrity_status: 'no_crossref_update_flag_at_retrieval_time',
    verified_at: verifiedAt,
  };
}

function validContactEmail(value: string | undefined): string | null {
  if (!value || value.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** Exported for contract tests and route-level observability without fetching. */
export function buildCrossrefRequestUrl(input: ResearchSourceRequest): URL {
  const url = new URL(CROSSREF_WORKS_URL);
  url.searchParams.set('query.bibliographic', input.query);
  url.searchParams.set('rows', '8');
  const filters = ['type:journal-article', 'has-update:0'];
  if (input.published_after_year !== undefined) {
    filters.push(`from-pub-date:${input.published_after_year}-01-01`);
  }
  url.searchParams.set('filter', filters.join(','));
  return url;
}

async function readJsonWithLimit(response: Response, byteLimit: number): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('json')) throw new Error('provider_content_type');

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
    throw new Error('provider_response_too_large');
  }

  if (!response.body) throw new Error('provider_empty_body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > byteLimit) {
      await reader.cancel();
      throw new Error('provider_response_too_large');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function itemsFromResponse(payload: unknown): unknown[] {
  if (!isRecord(payload) || !isRecord(payload.message) || !Array.isArray(payload.message.items)) {
    throw new Error('provider_schema');
  }
  return payload.message.items;
}

function retryDelay(response: Response): number {
  const raw = response.headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.floor(seconds * 1000));
  }
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return 0;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - Date.now()));
}

async function fetchCrossrefPayload(
  url: URL,
  options: CrossrefFetchOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const requestedTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(1, requestedTimeout));
  const requestedByteLimit = options.responseByteLimit ?? DEFAULT_RESPONSE_BYTE_LIMIT;
  const byteLimit = Math.min(MAX_RESPONSE_BYTE_LIMIT, Math.max(1, requestedByteLimit));
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + timeoutMs;

  const email = validContactEmail(options.contactEmail);
  if (email) url.searchParams.set('mailto', email);

  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('provider_timeout');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'KeepFlow/0.3 (https://keepflow.site)',
        },
        redirect: 'error',
        signal: controller.signal,
      });

      if (RETRYABLE_STATUSES.has(response.status)) {
        if (attempt === 0) {
          const delay = retryDelay(response);
          if (Date.now() + delay >= deadline) throw new Error('provider_unavailable');
          if (delay > 0) await sleep(delay);
          continue;
        }
        throw new Error('provider_unavailable');
      }

      if (!response.ok) throw new Error('provider_unavailable');
      return await readJsonWithLimit(response, byteLimit);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('provider_unavailable');
}

/**
 * Search Crossref without involving a model. Provider/network failures are
 * represented as an empty, explicit result so the caller can still deliver
 * the rest of a paid Study response without inventing citations.
 */
export async function recommendResearchSources(
  request: unknown,
  options: CrossrefFetchOptions = {},
): Promise<ResearchSourceResult> {
  const input = ResearchSourceRequestSchema.parse(request);
  const portals = buildOfficialResearchPortals(input.query, input.subject);

  try {
    const url = buildCrossrefRequestUrl(input);
    const payload = await fetchCrossrefPayload(url, options);
    const verifiedAt = (options.now ?? (() => new Date()))().toISOString();
    const seen = new Set<string>();
    const sources: VerifiedResearchSource[] = [];

    for (const item of itemsFromResponse(payload)) {
      const mapped = mapCrossrefItem(item, verifiedAt);
      if (!mapped) continue;
      const dedupeKey = mapped.doi.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      sources.push(mapped);
      if (sources.length >= input.max_results) break;
    }

    return {
      status: sources.length > 0 ? 'ok' : 'no_results',
      sources,
      portals,
    };
  } catch {
    return {
      status: 'temporarily_unavailable',
      sources: [],
      portals,
    };
  }
}

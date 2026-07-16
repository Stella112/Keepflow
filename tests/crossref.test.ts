import { describe, expect, it, vi } from 'vitest';
import {
  buildCrossrefRequestUrl,
  normalizeProviderText,
  recommendResearchSources,
  type CrossrefFetch,
} from '../src/research/crossref.js';
import {
  ResearchSourceRequestSchema,
  buildOfficialResearchPortals,
  type ResearchSourceRequest,
} from '../src/research/source-provider.js';

function request(overrides: Partial<ResearchSourceRequest> = {}): ResearchSourceRequest {
  return ResearchSourceRequestSchema.parse({
    query: 'spaced practice and student learning',
    subject: 'education',
    max_results: 5,
    ...overrides,
  });
}

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DOI: '10.1234/example.1',
    title: ['A Study of Spaced Practice'],
    author: [
      { given: 'Ada', family: 'Lovelace' },
      { given: 'Wei', family: 'Zhang' },
    ],
    issued: { 'date-parts': [[2024, 5, 1]] },
    'container-title': ['Journal of Learning Research'],
    publisher: 'Example University Press',
    type: 'journal-article',
    URL: 'https://malicious.example/not-used',
    score: 999,
    'is-referenced-by-count': 5000,
    ...overrides,
  };
}

function jsonResponse(items: unknown[], init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ message: { items } }), { ...init, headers });
}

const fixedNow = () => new Date('2026-07-16T12:00:00.000Z');

describe('Crossref research source request contract', () => {
  it('enforces a strict bounded request and provider category', () => {
    expect(() => request({ query: 'x' })).toThrow();
    expect(() => request({ query: 'x'.repeat(301) })).toThrow();
    expect(() => request({ max_results: 7 })).toThrow();
    expect(() =>
      ResearchSourceRequestSchema.parse({
        query: 'valid query',
        subject: 'history',
      }),
    ).toThrow();
    expect(() =>
      ResearchSourceRequestSchema.parse({
        query: 'valid query',
        subject: 'general',
        unexpected: true,
      }),
    ).toThrow();
  });

  it('accepts optional publication year only within the declared range', () => {
    expect(request({ published_after_year: 2020 }).published_after_year).toBe(2020);
    expect(request({ published_after_year: 1800 }).published_after_year).toBe(1800);
    expect(() => request({ published_after_year: 1499 })).toThrow();
    expect(() => request({ published_after_year: new Date().getUTCFullYear() + 1 })).toThrow();
  });

  it('constructs only the fixed HTTPS Crossref endpoint with bounded parameters', () => {
    const url = buildCrossrefRequestUrl(
      request({ query: '气候变化 & education?', max_results: 1, published_after_year: 2021 }),
    );

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('api.crossref.org');
    expect(url.pathname).toBe('/v1/works');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.searchParams.get('query.bibliographic')).toBe('气候变化 & education?');
    expect(url.searchParams.get('rows')).toBe('8');
    expect(url.searchParams.get('filter')).toBe(
      'type:journal-article,has-update:0,from-pub-date:2021-01-01',
    );
  });
});

describe('official research portal fallbacks', () => {
  it('always provides Crossref and adds only the subject-relevant official portal', () => {
    expect(buildOfficialResearchPortals('algebra & geometry', 'general').map((p) => p.provider))
      .toEqual(['crossref']);
    expect(buildOfficialResearchPortals('teaching methods', 'education').map((p) => p.provider))
      .toEqual(['crossref', 'eric']);

    for (const subject of ['medicine', 'health', 'life_science'] as const) {
      expect(buildOfficialResearchPortals('cell repair', subject).map((p) => p.provider))
        .toEqual(['crossref', 'pubmed']);
    }
  });

  it('encodes Unicode and reserved characters without changing portal hosts', () => {
    const portals = buildOfficialResearchPortals('教育 & learning? #1', 'education');
    expect(new URL(portals[0]!.url).hostname).toBe('search.crossref.org');
    expect(new URL(portals[0]!.url).searchParams.get('q')).toBe('教育 & learning? #1');
    expect(new URL(portals[1]!.url).hostname).toBe('eric.ed.gov');
    expect(new URL(portals[1]!.url).searchParams.get('q')).toBe('教育 & learning? #1');
    expect(portals.every((portal) => portal.kind === 'official_search_portal')).toBe(true);
  });
});

describe('Crossref verified source mapping', () => {
  it('copies provider metadata, ignores provider URLs and makes narrow integrity claims', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([item()])) as CrossrefFetch;
    const result = await recommendResearchSources(request(), { fetchImpl, now: fixedNow });

    expect(result.status).toBe('ok');
    expect(result.sources).toEqual([
      {
        provider: 'crossref',
        provider_id: '10.1234/example.1',
        doi: '10.1234/example.1',
        title: 'A Study of Spaced Practice',
        authors: ['Ada Lovelace', 'Wei Zhang'],
        issued_year: 2024,
        venue: 'Journal of Learning Research',
        publisher: 'Example University Press',
        work_type: 'journal-article',
        canonical_url: 'https://doi.org/10.1234/example.1',
        verification_status: 'crossref_registry_record_found',
        integrity_status: 'no_crossref_update_flag_at_retrieval_time',
        verified_at: '2026-07-16T12:00:00.000Z',
      },
    ]);
    expect(result.sources[0]!.canonical_url).not.toContain('malicious.example');
    const serialized = JSON.stringify(result.sources[0]);
    expect(serialized).not.toMatch(/peer.?review|quality|authoritative|unretracted/i);
  });

  it('drops records without a DOI or title and never fills missing results', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        item({ DOI: undefined }),
        item({ DOI: 'not-a-doi' }),
        item({ title: [] }),
        item({ title: [''] }),
      ])) as CrossrefFetch;

    const result = await recommendResearchSources(request(), { fetchImpl, now: fixedNow });
    expect(result).toMatchObject({ status: 'no_results', sources: [] });
  });

  it('drops correction, retraction, erratum, and supplemental-material records', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        item({ DOI: '10.1234/paper.supp', title: ['Supplemental Material for a Paper'] }),
        item({ DOI: '10.1234/correction', title: ['Correction: A Study'] }),
        item({ DOI: '10.1234/erratum', title: ['Erratum: A Study'] }),
        item({ DOI: '10.1234/retraction', title: ['Retraction: A Study'] }),
      ])) as CrossrefFetch;
    const result = await recommendResearchSources(request(), { fetchImpl, now: fixedNow });
    expect(result).toMatchObject({ status: 'no_results', sources: [] });
  });

  it('deduplicates DOI case-insensitively and respects the requested maximum', async () => {
    const providerItems = [
      item({ DOI: '10.1234/Case', title: ['First registry record'] }),
      item({ DOI: '10.1234/case', title: ['Duplicate registry record'] }),
      ...Array.from({ length: 7 }, (_, index) =>
        item({ DOI: `10.1234/source-${index}`, title: [`Source ${index}`] })),
    ];
    const fetchImpl = vi.fn(async () => jsonResponse(providerItems)) as CrossrefFetch;

    const result = await recommendResearchSources(request({ max_results: 6 }), {
      fetchImpl,
      now: fixedNow,
    });
    expect(result.sources).toHaveLength(6);
    expect(result.sources[0]!.title).toBe('First registry record');
    expect(result.sources.filter((source) => source.doi.toLowerCase() === '10.1234/case'))
      .toHaveLength(1);
  });

  it('normalizes HTML, encoded tags, controls and Unicode without executing markup', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        item({
          DOI: 'https://doi.org/10.5555/safe-record',
          title: [
            '<script>steal()</script><b>Cafe\u0301</b> &amp; &#x5b66;&#20064;\u0000',
          ],
          author: [{ given: '&lt;em&gt;Ana&lt;/em&gt;', family: 'O&#39;Neil' }],
          'container-title': ['<i>International</i> Review'],
        }),
      ])) as CrossrefFetch;

    const result = await recommendResearchSources(request(), { fetchImpl, now: fixedNow });
    expect(result.status).toBe('ok');
    expect(result.sources[0]!.title).toBe('Café & 学习');
    expect(result.sources[0]!.authors).toEqual(["Ana O'Neil"]);
    expect(result.sources[0]!.venue).toBe('International Review');
    expect(result.sources[0]!.canonical_url).toBe('https://doi.org/10.5555/safe-record');
    expect(JSON.stringify(result.sources[0])).not.toContain('<script>');
    expect(JSON.stringify(result.sources[0])).not.toContain('steal()');
  });

  it('skips provider records that cannot fit the public source contract', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        item({ DOI: '10.5555/安全', title: ['Unsupported non-ASCII DOI'] }),
        item({ DOI: '10.5555/long-title', title: ['x'.repeat(501)] }),
        item({ DOI: `10.5555/${'a'.repeat(201)}`, title: ['Oversized DOI'] }),
      ])) as CrossrefFetch;

    const result = await recommendResearchSources(request(), { fetchImpl, now: fixedNow });
    expect(result).toMatchObject({ status: 'no_results', sources: [] });
  });

  it('handles absent optional provider metadata without inventing it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        item({ author: undefined, issued: undefined, 'container-title': undefined, publisher: '' }),
      ])) as CrossrefFetch;
    const result = await recommendResearchSources(request(), { fetchImpl, now: fixedNow });

    expect(result.sources[0]).toMatchObject({
      authors: [],
      issued_year: null,
      venue: null,
      publisher: null,
    });
  });

  it('exports a plain-text normalizer that removes double-encoded markup and controls', () => {
    expect(normalizeProviderText('&amp;lt;b&amp;gt;Safe&amp;lt;/b&amp;gt;\u0007 text'))
      .toBe('Safe text');
  });
});

describe('Crossref network and response safety', () => {
  it('uses GET, rejects redirects and never permits a caller-controlled destination', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([item()])) as CrossrefFetch;
    await recommendResearchSources(
      request({ query: 'https://evil.example/?x=1 & still a topic' }),
      { fetchImpl, now: fixedNow, contactEmail: 'operator@keepflow.site' },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [destination, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(destination));
    expect(url.origin).toBe('https://api.crossref.org');
    expect(url.pathname).toBe('/v1/works');
    expect(url.searchParams.get('query.bibliographic')).toContain('evil.example');
    expect(url.searchParams.get('mailto')).toBe('operator@keepflow.site');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([429, 502, 503, 504])('retries status %i exactly once', async (status) => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status,
        headers: { 'retry-after': '10' },
      }))
      .mockResolvedValueOnce(jsonResponse([item()]));

    const result = await recommendResearchSources(request(), {
      fetchImpl: fetchImpl as CrossrefFetch,
      now: fixedNow,
      sleep,
    });
    expect(result.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('does not retry non-designated HTTP failures or network failures', async () => {
    const httpFetch = vi.fn(async () => new Response('', { status: 400 }));
    const httpResult = await recommendResearchSources(request(), {
      fetchImpl: httpFetch as CrossrefFetch,
    });
    expect(httpResult).toMatchObject({ status: 'temporarily_unavailable', sources: [] });
    expect(httpFetch).toHaveBeenCalledTimes(1);

    const networkFetch = vi.fn(async () => {
      throw new Error('private upstream detail');
    });
    const networkResult = await recommendResearchSources(request(), {
      fetchImpl: networkFetch as CrossrefFetch,
    });
    expect(networkResult).toMatchObject({ status: 'temporarily_unavailable', sources: [] });
    expect(networkFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(networkResult)).not.toContain('private upstream detail');
  });

  it('aborts an unresponsive provider within the configured deadline', async () => {
    const fetchImpl: CrossrefFetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    const started = Date.now();
    const result = await recommendResearchSources(request(), { fetchImpl, timeoutMs: 20 });

    expect(result).toMatchObject({ status: 'temporarily_unavailable', sources: [] });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('fails closed on declared or streamed oversized responses', async () => {
    const declaredFetch = vi.fn(async () =>
      new Response('{"message":{"items":[]}}', {
        headers: {
          'content-type': 'application/json',
          'content-length': '10000',
        },
      })) as CrossrefFetch;
    const declared = await recommendResearchSources(request(), {
      fetchImpl: declaredFetch,
      responseByteLimit: 100,
    });
    expect(declared).toMatchObject({ status: 'temporarily_unavailable', sources: [] });

    const streamedFetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: { items: [item({ padding: 'x'.repeat(500) })] } }), {
        headers: { 'content-type': 'application/json' },
      })) as CrossrefFetch;
    const streamed = await recommendResearchSources(request(), {
      fetchImpl: streamedFetch,
      responseByteLimit: 100,
    });
    expect(streamed).toMatchObject({ status: 'temporarily_unavailable', sources: [] });
  });

  it.each([
    new Response('not json', { headers: { 'content-type': 'text/plain' } }),
    new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ wrong: 'shape' }), {
      headers: { 'content-type': 'application/json' },
    }),
  ])('fails closed on malformed provider content', async (response) => {
    const fetchImpl = vi.fn(async () => response) as CrossrefFetch;
    const result = await recommendResearchSources(request(), { fetchImpl });
    expect(result).toMatchObject({ status: 'temporarily_unavailable', sources: [] });
    expect(result.portals.length).toBeGreaterThan(0);
  });

  it('returns official portals but no fabricated sources during an outage', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 })) as CrossrefFetch;
    const result = await recommendResearchSources(request({ subject: 'education' }), {
      fetchImpl,
      timeoutMs: 100,
      sleep: async () => undefined,
    });

    expect(result.status).toBe('temporarily_unavailable');
    expect(result.sources).toEqual([]);
    expect(result.portals.map((portal) => portal.provider)).toEqual(['crossref', 'eric']);
  });
});

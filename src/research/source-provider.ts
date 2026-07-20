import { z } from 'zod';

export const ResearchSubjectSchema = z.enum([
  'general',
  'education',
  'medicine',
  'health',
  'life_science',
]);

export type ResearchSubject = z.infer<typeof ResearchSubjectSchema>;

const CURRENT_YEAR = new Date().getUTCFullYear();

/**
 * A deliberately small request surface. The caller classifies a broader
 * course/subject string into one of these categories before calling the
 * provider. This keeps routing deterministic and prevents model inference
 * from changing which external service is contacted.
 */
export const ResearchSourceRequestSchema = z
  .object({
    query: z.string().trim().min(2).max(300),
    subject: ResearchSubjectSchema,
    max_results: z.number().int().min(1).max(6).default(5),
    published_after_year: z.number().int().min(1500).max(CURRENT_YEAR).optional(),
  })
  .strict();

export type ResearchSourceRequest = z.infer<typeof ResearchSourceRequestSchema>;

export interface VerifiedResearchSource {
  provider: 'crossref';
  provider_id: string;
  doi: string;
  title: string;
  authors: string[];
  issued_year: number | null;
  venue: string | null;
  publisher: string | null;
  work_type: string;
  canonical_url: string;
  verification_status: 'crossref_registry_record_found';
  integrity_status: 'no_crossref_update_flag_at_retrieval_time';
  quality_tier: 'stronger_metadata_match' | 'standard_metadata_match' | 'limited_metadata';
  quality_signals: {
    provider_relevance_score: number | null;
    citation_count: number | null;
    metadata_completeness: number;
  };
  selection_note: 'Registry metadata is verified; source quality and claims still require critical evaluation.';
  verified_at: string;
}

export interface OfficialResearchPortal {
  provider: 'crossref' | 'eric' | 'pubmed';
  label: string;
  url: string;
  kind: 'official_search_portal';
}

export interface ResearchSourceResult {
  status: 'ok' | 'no_results' | 'temporarily_unavailable';
  sources: VerifiedResearchSource[];
  portals: OfficialResearchPortal[];
}

function portalUrl(base: string, parameter: string, query: string): string {
  const url = new URL(base);
  url.searchParams.set(parameter, query);
  return url.toString();
}

/**
 * These are search destinations, not citations and not evidence that a
 * particular work exists. Keeping that distinction explicit prevents a
 * fallback link from being misrepresented as a verified source.
 */
export function buildOfficialResearchPortals(
  query: string,
  subject: ResearchSubject,
): OfficialResearchPortal[] {
  const portals: OfficialResearchPortal[] = [
    {
      provider: 'crossref',
      label: 'Crossref Metadata Search',
      url: portalUrl('https://search.crossref.org/', 'q', query),
      kind: 'official_search_portal',
    },
  ];

  if (subject === 'education') {
    portals.push({
      provider: 'eric',
      label: 'ERIC Education Research',
      url: portalUrl('https://eric.ed.gov/', 'q', query),
      kind: 'official_search_portal',
    });
  }

  if (subject === 'medicine' || subject === 'health' || subject === 'life_science') {
    portals.push({
      provider: 'pubmed',
      label: 'PubMed',
      url: portalUrl('https://pubmed.ncbi.nlm.nih.gov/', 'term', query),
      kind: 'official_search_portal',
    });
  }

  return portals;
}

import { Worker } from 'node:worker_threads';
import { STUDY_PDF_WORKER_SOURCE } from './study-pdf-worker.js';

export const STUDY_MATERIAL_MIN_CHARACTERS = 80;
export const STUDY_MATERIAL_MAX_CHARACTERS = 24_000;
export const STUDY_MATERIAL_MAX_PDF_BYTES = 1_048_576;
export const STUDY_MATERIAL_MAX_PDF_PAGES = 40;
export const STUDY_MATERIAL_CHUNK_CHARACTERS = 2_400;

const MAX_BASE64_CHARACTERS = Math.ceil(STUDY_MATERIAL_MAX_PDF_BYTES / 3) * 4;
const DEFAULT_PDF_TIMEOUT_MS = 5_000;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type StudyMaterialInput =
  | { type: 'text'; title: string; content: string }
  | { type: 'pdf_base64'; title: string; data: string };

export type StudyMaterialErrorCode =
  | 'invalid_material_title'
  | 'material_contains_nul'
  | 'material_too_short'
  | 'material_too_long'
  | 'invalid_pdf_base64'
  | 'pdf_too_large'
  | 'invalid_pdf_signature'
  | 'pdf_encrypted'
  | 'pdf_malformed'
  | 'pdf_page_limit'
  | 'pdf_no_extractable_text'
  | 'pdf_parse_timeout'
  | 'pdf_parser_busy';

export class StudyMaterialError extends Error {
  constructor(
    public readonly code: StudyMaterialErrorCode,
    public readonly status: 400 | 413 | 422 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'StudyMaterialError';
  }
}

export interface StudyMaterialChunk {
  chunk_id: string;
  excerpt: string;
  /** One-based PDF page, or null for caller-supplied text. */
  page_number: number | null;
  /** One-based lines within the document (text) or page (PDF). */
  line_start: number;
  line_end: number;
  /** Exact half-open character range within the document or PDF page. */
  source_char_start: number;
  source_char_end: number;
}

export interface ExtractedStudyMaterial {
  type: 'text' | 'pdf';
  title: string;
  chunks: StudyMaterialChunk[];
  coverage: {
    complete: true;
    source_characters: number;
    covered_characters: number;
    chunk_count: number;
    page_count: number | null;
    pages_with_text: number[] | null;
  };
}

export interface ParsedPdfText {
  totalPages: number;
  pages: string[];
}

export interface StudyMaterialExtractorOptions {
  /** Test seam; production callers should leave this unset. */
  pdfParser?: (bytes: Uint8Array) => Promise<ParsedPdfText>;
  /** Test seam. Production is always bounded by the 5-second default. */
  pdfTimeoutMs?: number;
}

interface WorkerSuccess {
  ok: true;
  totalPages: number;
  pages: string[];
}

interface WorkerFailure {
  ok: false;
  code: 'pdf_encrypted' | 'pdf_malformed' | 'pdf_page_limit';
}

let pdfParserActive = false;

function normalizeTitle(title: string): string {
  if (title.includes('\0')) {
    throw new StudyMaterialError(
      'invalid_material_title',
      400,
      'Material title contains an unsupported control character.',
    );
  }
  const normalized = normalizeControls(title).replace(/\s+/gu, ' ').trim();
  if (normalized.length < 1 || normalized.length > 160) {
    throw new StudyMaterialError(
      'invalid_material_title',
      400,
      'Material title must contain between 1 and 160 characters.',
    );
  }
  return normalized;
}

/** Normalize transport/control noise without folding or transliterating Unicode. */
export function normalizeStudyMaterialText(value: string): string {
  if (value.includes('\0')) {
    throw new StudyMaterialError(
      'material_contains_nul',
      400,
      'Study material must be text and cannot contain NUL bytes.',
    );
  }
  return normalizeControls(value).trim();
}

function normalizeControls(value: string): string {
  return value
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u000C\u0085\u2028\u2029]/gu, '\n')
    .replace(/\t/gu, '    ')
    .replace(/[\u0001-\u0008\u000B\u000E-\u001F\u007F-\u009F]/gu, '');
}

function validateTextLength(text: string): void {
  if (text.length < STUDY_MATERIAL_MIN_CHARACTERS) {
    throw new StudyMaterialError(
      'material_too_short',
      400,
      `Study material must contain at least ${STUDY_MATERIAL_MIN_CHARACTERS} characters after normalization.`,
    );
  }
  if (text.length > STUDY_MATERIAL_MAX_CHARACTERS) {
    throw new StudyMaterialError(
      'material_too_long',
      413,
      `Study material cannot exceed ${STUDY_MATERIAL_MAX_CHARACTERS} characters after normalization.`,
    );
  }
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  const bounded = Math.min(Math.max(offset, 0), text.length);
  for (let index = 0; index < bounded; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function chunkText(
  text: string,
  pageNumber: number | null,
): StudyMaterialChunk[] {
  const chunks: StudyMaterialChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + STUDY_MATERIAL_CHUNK_CHARACTERS, text.length);
    if (end < text.length) {
      const minimumBreak = start + Math.floor(STUDY_MATERIAL_CHUNK_CHARACTERS * 0.55);
      const newline = text.lastIndexOf('\n', end - 1);
      const space = text.lastIndexOf(' ', end - 1);
      const boundary = Math.max(newline, space);
      if (boundary >= minimumBreak) end = boundary + 1;
    }

    const excerpt = text.slice(start, end);
    const ordinal = chunks.length + 1;
    chunks.push({
      chunk_id: `M1:P${String(pageNumber ?? 0).padStart(3, '0')}:C${String(ordinal).padStart(3, '0')}`,
      excerpt,
      page_number: pageNumber,
      line_start: lineNumberAt(text, start),
      line_end: lineNumberAt(text, Math.max(start, end - 1)),
      source_char_start: start,
      source_char_end: end,
    });
    start = end;
  }
  return chunks;
}

function decodeCanonicalPdf(data: string): Uint8Array {
  if (
    data.length === 0 ||
    data.length > MAX_BASE64_CHARACTERS ||
    data.startsWith('data:') ||
    !CANONICAL_BASE64.test(data)
  ) {
    const code = data.length > MAX_BASE64_CHARACTERS ? 'pdf_too_large' : 'invalid_pdf_base64';
    throw new StudyMaterialError(
      code,
      code === 'pdf_too_large' ? 413 : 400,
      code === 'pdf_too_large'
        ? `PDF cannot exceed ${STUDY_MATERIAL_MAX_PDF_BYTES} decoded bytes.`
        : 'PDF data must be canonical base64 without a data-URI prefix.',
    );
  }

  const decoded = Buffer.from(data, 'base64');
  if (decoded.length > STUDY_MATERIAL_MAX_PDF_BYTES) {
    decoded.fill(0);
    throw new StudyMaterialError(
      'pdf_too_large',
      413,
      `PDF cannot exceed ${STUDY_MATERIAL_MAX_PDF_BYTES} decoded bytes.`,
    );
  }
  if (decoded.toString('base64') !== data) {
    decoded.fill(0);
    throw new StudyMaterialError(
      'invalid_pdf_base64',
      400,
      'PDF data must use canonical base64 encoding.',
    );
  }
  if (decoded.length < 5 || decoded.subarray(0, 5).toString('ascii') !== '%PDF-') {
    decoded.fill(0);
    throw new StudyMaterialError(
      'invalid_pdf_signature',
      400,
      'Decoded material is not a supported PDF.',
    );
  }
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
}

function normalizeWorkerResult(value: unknown): ParsedPdfText {
  if (!value || typeof value !== 'object') {
    throw new StudyMaterialError('pdf_malformed', 422, 'PDF could not be parsed safely.');
  }
  const result = value as {
    ok?: unknown;
    code?: unknown;
    totalPages?: unknown;
    pages?: unknown;
  };
  if (result.ok === false) {
    if (result.code === 'pdf_encrypted') {
      throw new StudyMaterialError(
        'pdf_encrypted',
        422,
        'Password-protected or encrypted PDFs are not supported.',
      );
    }
    if (result.code === 'pdf_page_limit') {
      throw new StudyMaterialError(
        'pdf_page_limit',
        413,
        `PDF cannot exceed ${STUDY_MATERIAL_MAX_PDF_PAGES} pages.`,
      );
    }
    throw new StudyMaterialError('pdf_malformed', 422, 'PDF could not be parsed safely.');
  }
  if (
    result.ok !== true ||
    !Number.isInteger(result.totalPages) ||
    typeof result.totalPages !== 'number' ||
    !Array.isArray(result.pages) ||
    !result.pages.every((page: unknown) => typeof page === 'string') ||
    result.pages.length !== result.totalPages
  ) {
    throw new StudyMaterialError('pdf_malformed', 422, 'PDF parser returned an invalid result.');
  }
  if (result.totalPages < 1 || result.totalPages > STUDY_MATERIAL_MAX_PDF_PAGES) {
    throw new StudyMaterialError(
      'pdf_page_limit',
      413,
      `PDF must contain between 1 and ${STUDY_MATERIAL_MAX_PDF_PAGES} pages.`,
    );
  }
  return { totalPages: result.totalPages, pages: result.pages as string[] };
}

async function parsePdfInWorker(bytes: Uint8Array, timeoutMs: number): Promise<ParsedPdfText> {
  const isolated = Uint8Array.from(bytes);
  const worker = new Worker(STUDY_PDF_WORKER_SOURCE, {
    eval: true,
    name: 'keepflow-study-pdf-parser',
    // Do not copy model/payment credentials into the untrusted-file parser.
    env: { NODE_ENV: process.env.NODE_ENV ?? 'production' },
    execArgv: [],
    resourceLimits: {
      maxOldGenerationSizeMb: 64,
      maxYoungGenerationSizeMb: 16,
      stackSizeMb: 4,
    },
  });

  return await new Promise<ParsedPdfText>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: ParsedPdfText) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      finish(
        new StudyMaterialError(
          'pdf_parse_timeout',
          422,
          'PDF parsing exceeded the safe time limit.',
        ),
      );
    }, timeoutMs);

    worker.once('message', (message: unknown) => {
      try {
        finish(undefined, normalizeWorkerResult(message));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('PDF parse failed'));
      }
    });
    worker.once('error', () => {
      finish(new StudyMaterialError('pdf_malformed', 422, 'PDF worker failed safely.'));
    });
    worker.once('exit', (code) => {
      if (code !== 0 && !settled) {
        finish(new StudyMaterialError('pdf_malformed', 422, 'PDF worker exited safely.'));
      }
    });

    worker.postMessage({ bytes: isolated.buffer }, [isolated.buffer]);
  });
}

async function parsePdfBounded(
  bytes: Uint8Array,
  options: StudyMaterialExtractorOptions,
): Promise<ParsedPdfText> {
  if (pdfParserActive) {
    throw new StudyMaterialError(
      'pdf_parser_busy',
      503,
      'The bounded PDF parser is busy; retry shortly.',
    );
  }
  pdfParserActive = true;
  const timeoutMs = Math.max(1, Math.min(options.pdfTimeoutMs ?? DEFAULT_PDF_TIMEOUT_MS, 5_000));
  try {
    if (!options.pdfParser) return await parsePdfInWorker(bytes, timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new StudyMaterialError(
              'pdf_parse_timeout',
              422,
              'PDF parsing exceeded the safe time limit.',
            ),
          );
        }, timeoutMs);
      });
      return normalizeWorkerResult({ ok: true, ...(await Promise.race([options.pdfParser(bytes), timeout])) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    pdfParserActive = false;
  }
}

function buildTextResult(title: string, text: string): ExtractedStudyMaterial {
  validateTextLength(text);
  const chunks = chunkText(text, null);
  return {
    type: 'text',
    title,
    chunks,
    coverage: {
      complete: true,
      source_characters: text.length,
      covered_characters: chunks.reduce((sum, chunk) => sum + chunk.excerpt.length, 0),
      chunk_count: chunks.length,
      page_count: null,
      pages_with_text: null,
    },
  };
}

function buildPdfResult(
  title: string,
  parsed: ParsedPdfText,
): ExtractedStudyMaterial {
  const normalizedPages = parsed.pages.map(normalizeStudyMaterialText);
  const sourceCharacters = normalizedPages.reduce((sum, page) => sum + page.length, 0);
  if (sourceCharacters === 0) {
    throw new StudyMaterialError(
      'pdf_no_extractable_text',
      422,
      'PDF contains no extractable text; scanned/image-only PDFs are not supported.',
    );
  }
  if (sourceCharacters < STUDY_MATERIAL_MIN_CHARACTERS) {
    throw new StudyMaterialError(
      'material_too_short',
      400,
      `Extracted PDF text must contain at least ${STUDY_MATERIAL_MIN_CHARACTERS} characters.`,
    );
  }
  // Page separators are not source text and therefore do not count toward
  // coverage or the 24k material ceiling.
  if (sourceCharacters > STUDY_MATERIAL_MAX_CHARACTERS) {
    throw new StudyMaterialError(
      'material_too_long',
      413,
      `Extracted PDF text cannot exceed ${STUDY_MATERIAL_MAX_CHARACTERS} characters.`,
    );
  }

  const chunks = normalizedPages.flatMap((page, index) =>
    page.length ? chunkText(page, index + 1) : [],
  );
  const pagesWithText = normalizedPages.flatMap((page, index) =>
    page.length ? [index + 1] : [],
  );
  return {
    type: 'pdf',
    title,
    chunks,
    coverage: {
      complete: true,
      source_characters: sourceCharacters,
      covered_characters: chunks.reduce((sum, chunk) => sum + chunk.excerpt.length, 0),
      chunk_count: chunks.length,
      page_count: parsed.totalPages,
      pages_with_text: pagesWithText,
    },
  };
}

export async function extractStudyMaterial(
  material: StudyMaterialInput,
  options: StudyMaterialExtractorOptions = {},
): Promise<ExtractedStudyMaterial> {
  const title = normalizeTitle(material.title);
  if (material.type === 'text') {
    return buildTextResult(title, normalizeStudyMaterialText(material.content));
  }

  const bytes = decodeCanonicalPdf(material.data);
  try {
    const parsed = await parsePdfBounded(bytes, options);
    return buildPdfResult(title, parsed);
  } finally {
    // Best effort only: JavaScript strings and parser-internal copies cannot be
    // guaranteed to be zeroized, but every mutable caller-side byte is cleared.
    bytes.fill(0);
  }
}

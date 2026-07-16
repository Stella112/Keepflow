import { describe, expect, it } from 'vitest';
import {
  extractStudyMaterial,
  normalizeStudyMaterialText,
  STUDY_MATERIAL_MAX_CHARACTERS,
  STUDY_MATERIAL_MAX_PDF_BYTES,
  type ParsedPdfText,
} from '../src/engine/study-material-extractor.js';

function makePdfBytes(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 6\n';
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function fakePdfBase64(): string {
  return Buffer.from(`%PDF-1.4\n${'bounded fixture '.repeat(8)}`, 'utf8').toString('base64');
}

function parsedPage(text = 'A bounded, source-grounded explanation begins with this supplied page. '.repeat(3)): ParsedPdfText {
  return { totalPages: 1, pages: [text] };
}

describe('study material extractor', () => {
  it('normalizes safe controls while preserving multilingual Unicode exactly', async () => {
    const content =
      '\uFEFF研究資料：因果関係を説明します。\r\n\tالعربية تبقى كما هي.\u001b\u0007\n' +
      'The remaining paragraph supplies enough grounded detail for a focused explanation.';
    const output = await extractStudyMaterial({
      type: 'text',
      title: '  Biology notes  ',
      content,
    });
    const reconstructed = output.chunks.map((chunk) => chunk.excerpt).join('');

    expect(output.title).toBe('Biology notes');
    expect(reconstructed).toBe(normalizeStudyMaterialText(content));
    expect(reconstructed).toContain('研究資料');
    expect(reconstructed).toContain('العربية');
    expect(reconstructed).not.toContain('\r');
    expect(reconstructed).not.toContain('\u001b');
    expect(output.coverage.covered_characters).toBe(output.coverage.source_characters);
    expect(output.coverage.complete).toBe(true);
  });

  it('creates bounded exact chunks with stable ids and line metadata', async () => {
    const content = Array.from(
      { length: 90 },
      (_, index) => `Line ${index + 1}: evidence and explanation remain tied to the supplied source material.`,
    ).join('\n');
    const material = { type: 'text' as const, title: 'Long notes', content };
    const first = await extractStudyMaterial(material);
    const second = await extractStudyMaterial(material);

    expect(first.chunks.length).toBeGreaterThan(1);
    expect(first.chunks.map((chunk) => chunk.chunk_id)).toEqual(
      second.chunks.map((chunk) => chunk.chunk_id),
    );
    first.chunks.forEach((chunk, index) => {
      expect(chunk.chunk_id).toBe(`M1:P000:C${String(index + 1).padStart(3, '0')}`);
    });
    expect(first.chunks.every((chunk) => chunk.excerpt.length <= 2_400)).toBe(true);
    for (const chunk of first.chunks) {
      expect(content.slice(chunk.source_char_start, chunk.source_char_end)).toBe(chunk.excerpt);
      expect(chunk.page_number).toBeNull();
      expect(chunk.line_start).toBeGreaterThan(0);
      expect(chunk.line_end).toBeGreaterThanOrEqual(chunk.line_start);
    }
    expect(first.chunks.map((chunk) => chunk.excerpt).join('')).toBe(content);
  });

  it('rejects NUL-bearing, too-short, and too-long inline material', async () => {
    await expect(
      extractStudyMaterial({ type: 'text', title: 'Notes', content: `Safe text ${'x'.repeat(80)}\0hidden` }),
    ).rejects.toMatchObject({ code: 'material_contains_nul', status: 400 });
    await expect(
      extractStudyMaterial({ type: 'text', title: 'Notes', content: 'too short' }),
    ).rejects.toMatchObject({ code: 'material_too_short', status: 400 });
    await expect(
      extractStudyMaterial({
        type: 'text',
        title: 'Notes',
        content: 'x'.repeat(STUDY_MATERIAL_MAX_CHARACTERS + 1),
      }),
    ).rejects.toMatchObject({ code: 'material_too_long', status: 413 });
  });

  it('requires canonical base64 without data URIs or whitespace', async () => {
    const parser = async () => parsedPage();
    for (const data of [
      `data:application/pdf;base64,${fakePdfBase64()}`,
      `${fakePdfBase64()}\n`,
      'JVBERi0xLjQ',
      '%%%%',
    ]) {
      await expect(
        extractStudyMaterial(
          { type: 'pdf_base64', title: 'PDF', data },
          { pdfParser: parser },
        ),
      ).rejects.toMatchObject({ code: 'invalid_pdf_base64', status: 400 });
    }
  });

  it('rejects oversized decoded input before parsing', async () => {
    const oversized = Buffer.alloc(STUDY_MATERIAL_MAX_PDF_BYTES + 1, 1).toString('base64');
    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'PDF', data: oversized },
        { pdfParser: async () => parsedPage() },
      ),
    ).rejects.toMatchObject({ code: 'pdf_too_large', status: 413 });
  });

  it('requires the PDF signature at byte zero', async () => {
    const renamedText = Buffer.from(`not-a-pdf ${'x'.repeat(100)}`).toString('base64');
    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'PDF', data: renamedText },
        { pdfParser: async () => parsedPage() },
      ),
    ).rejects.toMatchObject({ code: 'invalid_pdf_signature', status: 400 });
  });

  it('preserves page-aware exact excerpts and complete coverage', async () => {
    const pages = [
      `First page\n${'alpha evidence '.repeat(230)}`,
      `Second page\n${'beta explanation '.repeat(90)}`,
    ];
    const output = await extractStudyMaterial(
      { type: 'pdf_base64', title: 'Two-page material', data: fakePdfBase64() },
      { pdfParser: async () => ({ totalPages: 2, pages }) },
    );

    expect(output.type).toBe('pdf');
    expect(output.coverage.page_count).toBe(2);
    expect(output.coverage.pages_with_text).toEqual([1, 2]);
    expect(output.chunks[0]?.chunk_id).toBe('M1:P001:C001');
    expect(output.chunks.find((chunk) => chunk.page_number === 2)?.chunk_id).toBe('M1:P002:C001');
    for (const chunk of output.chunks) {
      const page = normalizeStudyMaterialText(pages[chunk.page_number! - 1]!);
      expect(page.slice(chunk.source_char_start, chunk.source_char_end)).toBe(chunk.excerpt);
    }
    expect(output.coverage.covered_characters).toBe(output.coverage.source_characters);
  });

  it('rejects textless/scanned PDFs and invalid parser results', async () => {
    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'Scan', data: fakePdfBase64() },
        { pdfParser: async () => ({ totalPages: 2, pages: ['', '   \n'] }) },
      ),
    ).rejects.toMatchObject({ code: 'pdf_no_extractable_text', status: 422 });

    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'Broken', data: fakePdfBase64() },
        {
          pdfParser: async () => ({ totalPages: 2, pages: ['only one page'] } as ParsedPdfText),
        },
      ),
    ).rejects.toMatchObject({ code: 'pdf_malformed', status: 422 });
  });

  it('enforces the PDF page and extracted-character limits', async () => {
    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'Long PDF', data: fakePdfBase64() },
        { pdfParser: async () => ({ totalPages: 41, pages: Array(41).fill('text') }) },
      ),
    ).rejects.toMatchObject({ code: 'pdf_page_limit', status: 413 });

    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'Dense PDF', data: fakePdfBase64() },
        {
          pdfParser: async () => ({
            totalPages: 1,
            pages: ['x'.repeat(STUDY_MATERIAL_MAX_CHARACTERS + 1)],
          }),
        },
      ),
    ).rejects.toMatchObject({ code: 'material_too_long', status: 413 });
  });

  it('times out a stalled parser and releases the concurrency slot', async () => {
    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'Stalled PDF', data: fakePdfBase64() },
        { pdfParser: async () => await new Promise<ParsedPdfText>(() => {}), pdfTimeoutMs: 10 },
      ),
    ).rejects.toMatchObject({ code: 'pdf_parse_timeout', status: 422 });

    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'Next PDF', data: fakePdfBase64() },
        { pdfParser: async () => parsedPage() },
      ),
    ).resolves.toMatchObject({ type: 'pdf' });
  });

  it('allows at most one PDF parser at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = extractStudyMaterial(
      { type: 'pdf_base64', title: 'First PDF', data: fakePdfBase64() },
      {
        pdfParser: async () => {
          await gate;
          return parsedPage();
        },
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(
      extractStudyMaterial(
        { type: 'pdf_base64', title: 'Second PDF', data: fakePdfBase64() },
        { pdfParser: async () => parsedPage() },
      ),
    ).rejects.toMatchObject({ code: 'pdf_parser_busy', status: 503 });

    release();
    await expect(first).resolves.toMatchObject({ type: 'pdf' });
  });

  it('best-effort zeroes caller-side decoded bytes after parsing', async () => {
    let observed: Uint8Array | undefined;
    await extractStudyMaterial(
      { type: 'pdf_base64', title: 'Sensitive bytes', data: fakePdfBase64() },
      {
        pdfParser: async (bytes) => {
          observed = bytes;
          expect(bytes.some((value) => value !== 0)).toBe(true);
          return parsedPage();
        },
      },
    );
    expect(observed).toBeDefined();
    expect(observed!.every((value) => value === 0)).toBe(true);
  });

  it(
    'extracts text from a real bounded PDF in the isolated unpdf worker',
    async () => {
      const sentence =
        'Photosynthesis converts light energy into chemical energy, and chlorophyll helps absorb the light used by the plant.';
      const pdf = makePdfBytes(sentence);
      const output = await extractStudyMaterial({
        type: 'pdf_base64',
        title: 'Photosynthesis lesson',
        data: pdf.toString('base64'),
      });

      expect(output.type).toBe('pdf');
      expect(output.coverage.page_count).toBe(1);
      expect(output.coverage.pages_with_text).toEqual([1]);
      expect(output.chunks.map((chunk) => chunk.excerpt).join(' ')).toContain('Photosynthesis');
      expect(output.coverage.covered_characters).toBe(output.coverage.source_characters);
    },
    20_000,
  );
});

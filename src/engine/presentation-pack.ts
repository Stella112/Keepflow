import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { PresentationPackInput } from '../schemas/presentation-pack-input.js';
import {
  PresentationPackOutputSchema,
  type PresentationPackOutput,
} from '../schemas/presentation-pack-output.js';
import type { StudyAssistPersonalDataCategory } from '../security/study-assist-guard.js';
import {
  buildDeterministicPresentationPlan,
  validatePresentationPlan,
  type PresentationPlan,
  type PresentationPlanner,
} from './presentation-plan.js';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation' as const;
const MAX_PPTX_BYTES = 6 * 1024 * 1024;

interface PptxSlide {
  background: { color: string };
  addShape(shape: unknown, options: Record<string, unknown>): void;
  addText(text: string, options: Record<string, unknown>): void;
  addNotes(notes: string): void;
}

interface PptxInstance {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  revision: string;
  theme: { headFontFace: string; bodyFontFace: string };
  ShapeType: Record<string, unknown>;
  addSlide(): PptxSlide;
  write(options: {
    outputType: 'nodebuffer';
    compression: boolean;
  }): Promise<unknown>;
}

type PptxConstructor = new () => PptxInstance;
const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs') as PptxConstructor;

export interface PptxInspection {
  slideCount: number;
  speakerNotesSlideCount: number;
  archiveEntryCount: number;
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return normalized || 'keepflow-presentation';
}

function contrastingText(hex: string): string {
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? '10182C' : 'F4F8F7';
}

function addFooter(
  pptx: PptxInstance,
  slide: PptxSlide,
  input: PresentationPackInput,
  slideNumber: number,
): void {
  const primary = input.branding.primary_color;
  const footer = input.branding.footer_text ?? input.branding.brand_name ?? 'KeepFlow';
  slide.addShape(pptx.ShapeType.line, {
    x: 0.72,
    y: 7.03,
    w: 11.88,
    h: 0,
    line: { color: 'D9E2E1', width: 1 },
  });
  slide.addText(footer, {
    x: 0.78,
    y: 7.1,
    w: 5,
    h: 0.18,
    fontFace: 'Aptos',
    fontSize: 10,
    color: primary,
    bold: true,
    margin: 0,
  });
  slide.addText(String(slideNumber).padStart(2, '0'), {
    x: 11.7,
    y: 7.1,
    w: 0.85,
    h: 0.18,
    fontFace: 'Aptos',
    fontSize: 10,
    color: '62706E',
    align: 'right',
    margin: 0,
  });
}

function renderTitleSlide(
  pptx: PptxInstance,
  input: PresentationPackInput,
  plan: PresentationPlan,
  slidePlan: PresentationPlan['slides'][number],
): void {
  const primary = input.branding.primary_color;
  const accent = input.branding.accent_color;
  const foreground = contrastingText(primary);
  const slide = pptx.addSlide();
  slide.background = { color: primary };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.22,
    h: 7.5,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  });
  slide.addText(input.branding.brand_name ?? 'KEEPFLOW', {
    x: 0.86,
    y: 0.7,
    w: 5.5,
    h: 0.35,
    fontFace: 'Aptos',
    fontSize: 16,
    bold: true,
    charSpacing: 1.8,
    color: accent,
    margin: 0,
  });
  slide.addText(slidePlan.title, {
    x: 0.86,
    y: 2.05,
    w: 10.8,
    h: 1.5,
    fontFace: 'Aptos Display',
    fontSize: 50,
    bold: true,
    color: foreground,
    breakLine: false,
    fit: 'shrink',
    margin: 0,
    valign: 'mid',
  });
  slide.addText(slidePlan.takeaway, {
    x: 0.9,
    y: 4.1,
    w: 9.8,
    h: 1.05,
    fontFace: 'Aptos',
    fontSize: 24,
    color: 'D9E7E5',
    margin: 0,
    fit: 'shrink',
  });
  slide.addText(`${input.audience}  •  ${input.output_language}`, {
    x: 0.9,
    y: 6.6,
    w: 7,
    h: 0.3,
    fontFace: 'Aptos',
    fontSize: 12,
    color: '9FB5B1',
    margin: 0,
  });
  slide.addNotes(slidePlan.speaker_notes);
  pptx.subject = plan.communication_job;
}

function renderContentSlide(
  pptx: PptxInstance,
  input: PresentationPackInput,
  slidePlan: PresentationPlan['slides'][number],
  slideNumber: number,
): void {
  const primary = input.branding.primary_color;
  const accent = input.branding.accent_color;
  const slide = pptx.addSlide();
  slide.background = { color: 'F6F9F8' };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.14,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  });
  slide.addText(slidePlan.title, {
    x: 0.78,
    y: 0.55,
    w: 11.8,
    h: 0.72,
    fontFace: 'Aptos Display',
    fontSize: 36,
    bold: true,
    color: primary,
    margin: 0,
    fit: 'shrink',
  });
  slide.addText(slidePlan.takeaway, {
    x: 0.8,
    y: 1.46,
    w: 11.45,
    h: 0.78,
    fontFace: 'Aptos',
    fontSize: 24,
    bold: true,
    color: '254B55',
    margin: 0,
    fit: 'shrink',
  });

  slidePlan.bullets.forEach((bullet, index) => {
    const y = 2.52 + index * 0.92;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.86,
      y: y + 0.17,
      w: 0.13,
      h: 0.13,
      line: { color: accent, transparency: 100 },
      fill: { color: accent },
    });
    slide.addText(bullet, {
      x: 1.16,
      y,
      w: 10.85,
      h: 0.7,
      fontFace: 'Aptos',
      fontSize: 18,
      color: '253330',
      margin: 0,
      breakLine: false,
      fit: 'shrink',
      valign: 'mid',
    });
  });

  slide.addText(`Evidence: ${slidePlan.evidence_ids.join(', ')}`, {
    x: 0.8,
    y: 6.64,
    w: 9.2,
    h: 0.22,
    fontFace: 'Aptos',
    fontSize: 11,
    color: '62706E',
    italic: true,
    margin: 0,
  });
  addFooter(pptx, slide, input, slideNumber);
  slide.addNotes(slidePlan.speaker_notes);
}

function renderClosingSlide(
  pptx: PptxInstance,
  input: PresentationPackInput,
  slidePlan: PresentationPlan['slides'][number],
): void {
  const primary = input.branding.primary_color;
  const accent = input.branding.accent_color;
  const foreground = contrastingText(primary);
  const slide = pptx.addSlide();
  slide.background = { color: primary };
  slide.addShape(pptx.ShapeType.line, {
    x: 0.9,
    y: 1.35,
    w: 2.1,
    h: 0,
    line: { color: accent, width: 4 },
  });
  slide.addText(slidePlan.title, {
    x: 0.9,
    y: 2,
    w: 10.9,
    h: 1.2,
    fontFace: 'Aptos Display',
    fontSize: 42,
    bold: true,
    color: foreground,
    margin: 0,
    fit: 'shrink',
  });
  slide.addText(slidePlan.takeaway, {
    x: 0.92,
    y: 3.75,
    w: 9.9,
    h: 1.25,
    fontFace: 'Aptos',
    fontSize: 24,
    color: 'D9E7E5',
    margin: 0,
    fit: 'shrink',
  });
  slide.addText(input.branding.brand_name ?? 'KeepFlow', {
    x: 0.92,
    y: 6.65,
    w: 4,
    h: 0.3,
    fontFace: 'Aptos',
    fontSize: 13,
    bold: true,
    color: accent,
    margin: 0,
  });
  slide.addNotes(slidePlan.speaker_notes);
}

export async function renderPresentationPptx(
  input: PresentationPackInput,
  plan: PresentationPlan,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'KeepFlow';
  pptx.company = input.branding.brand_name ?? 'KeepFlow';
  pptx.subject = plan.communication_job;
  pptx.title = plan.deck_title;
  pptx.revision = '1';
  pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' };

  plan.slides.forEach((slidePlan, index) => {
    if (slidePlan.kind === 'title') {
      renderTitleSlide(pptx, input, plan, slidePlan);
    } else if (slidePlan.kind === 'closing') {
      renderClosingSlide(pptx, input, slidePlan);
    } else {
      renderContentSlide(pptx, input, slidePlan, index + 1);
    }
  });

  const raw = await pptx.write({ outputType: 'nodebuffer', compression: true });
  const buffer = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
      ? Buffer.from(raw)
      : null;
  if (!buffer) throw new Error('pptx renderer returned an unsupported output type');
  if (buffer.length === 0 || buffer.length > MAX_PPTX_BYTES) {
    throw new Error('pptx renderer produced an invalid file size');
  }
  return buffer;
}

export async function inspectPresentationPptx(
  buffer: Buffer,
  expectedSlideCount: number,
): Promise<PptxInspection> {
  if (buffer.length < 4 || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new Error('presentation is not an OOXML ZIP archive');
  }
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const names = Object.keys(zip.files);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']) {
    if (!zip.file(required)) throw new Error(`presentation is missing ${required}`);
  }
  if (names.some((name) => /vbaProject\.bin|ppt\/externalLinks\//i.test(name))) {
    throw new Error('presentation contains a prohibited active or external component');
  }
  const slideCount = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  const speakerNotesSlideCount = names.filter(
    (name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name),
  ).length;
  if (slideCount !== expectedSlideCount) {
    throw new Error('presentation archive slide count does not match the plan');
  }
  if (speakerNotesSlideCount !== expectedSlideCount) {
    throw new Error('presentation archive is missing speaker notes');
  }
  return { slideCount, speakerNotesSlideCount, archiveEntryCount: names.length };
}

export async function buildPresentationPack(
  input: PresentationPackInput,
  planner: PresentationPlanner | null,
  personalDataMasked: StudyAssistPersonalDataCategory[] = [],
): Promise<{ output: PresentationPackOutput; plan: PresentationPlan; inspection: PptxInspection }> {
  const planned = planner ? await planner.plan({ input, sourceItems: input.source_items }) : null;
  const plan = planned ?? buildDeterministicPresentationPlan(input, input.source_items);
  const planValidation = validatePresentationPlan(plan, input, input.source_items);
  if (!planValidation.valid) {
    throw new Error(`presentation plan failed validation: ${planValidation.errors.join('; ')}`);
  }

  const buffer = await renderPresentationPptx(input, plan);
  const inspection = await inspectPresentationPptx(buffer, plan.slides.length);
  const contentBase64 = buffer.toString('base64');
  const output: PresentationPackOutput = {
    service: 'KeepFlow Presentation Pack - Grounded Slide Creation',
    domain: input.domain,
    generation_mode: planned ? 'grounded_ai' : 'deterministic_fallback',
    title: plan.deck_title,
    slide_count: plan.slides.length,
    source_evidence_count: input.source_items.length,
    personal_data_masked: personalDataMasked,
    presentation_file: {
      filename: `${slug(plan.deck_title)}.pptx`,
      mime_type: PPTX_MIME,
      encoding: 'base64',
      byte_length: buffer.length,
      content_base64: contentBase64,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    },
    quality: {
      schema_validated: true,
      archive_validated: true,
      evidence_references_validated: true,
      speaker_notes_slide_count: inspection.speakerNotesSlideCount,
    },
    limitations: [
      'The presentation is grounded in caller-supplied source items; KeepFlow does not certify that those sources are accurate or complete.',
      'The PPTX should be reviewed by the caller before external use, especially where decisions, grades, legal duties, or regulated claims are involved.',
      'KeepFlow does not retain the generated presentation after this response.',
    ],
    meta: {
      asp: 'KeepFlow',
      schema_version: '1.0.0',
      generated_at: new Date().toISOString(),
      stateless: true,
      stores_files: false,
    },
  };

  const parsed = PresentationPackOutputSchema.safeParse(output);
  if (!parsed.success) throw new Error('presentation output failed schema validation');
  if (Buffer.from(contentBase64, 'base64').toString('base64') !== contentBase64) {
    throw new Error('presentation output is not canonical base64');
  }
  return { output: parsed.data, plan, inspection };
}

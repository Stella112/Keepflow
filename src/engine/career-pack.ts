import { createHash } from 'node:crypto';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';
import type { CareerPackInput } from '../schemas/career-pack-input.js';
import { CareerPackOutputSchema, type CareerPackOutput } from '../schemas/career-pack-output.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const STOP_WORDS = new Set(['and','the','with','for','from','that','this','you','your','our','are','will','have','has','into','using','role','team','work','years','who','but','not','all','any']);

function keywords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []) {
    if (STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 24).map(([word]) => word);
}

function artifact(filename: string, mime_type: string, bytes: Buffer) {
  return {
    filename,
    mime_type,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    content_base64: bytes.toString('base64'),
  };
}

function resumeText(input: CareerPackInput, summary: string): string[] {
  const lines = [input.candidate.name, input.candidate.contact_line ?? '', input.candidate.location ?? '', '', input.target_role, summary, '', 'SKILLS', input.candidate.skills.join(' • '), '', 'EXPERIENCE'];
  for (const item of input.candidate.experience) {
    lines.push(`${item.role} — ${item.organization} | ${item.period}`, ...item.achievements.map((value) => `• ${value}`), '');
  }
  if (input.candidate.education.length) lines.push('EDUCATION', ...input.candidate.education);
  if (input.candidate.certifications.length) lines.push('', 'CERTIFICATIONS', ...input.candidate.certifications);
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '');
}

async function makeDocx(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line, index) => new Paragraph({
    heading: ['SKILLS','EXPERIENCE','EDUCATION','CERTIFICATIONS'].includes(line) ? HeadingLevel.HEADING_2 : undefined,
    children: [new TextRun({ text: line, bold: index === 0 })],
  })) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function makePdf(lines: string[]): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, left: 50, right: 50, bottom: 48 } });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    lines.forEach((line, index) => {
      const heading = ['SKILLS','EXPERIENCE','EDUCATION','CERTIFICATIONS'].includes(line);
      doc.font(heading || index === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(index === 0 ? 20 : heading ? 12 : 10.5).fillColor(index === 0 || heading ? '#10182C' : '#253330').text(line, { paragraphGap: line.startsWith('•') ? 2 : 5 });
    });
    doc.end();
  });
}

export async function buildCareerPack(input: CareerPackInput): Promise<CareerPackOutput> {
  const evidence = [
    ...input.candidate.professional_summary_facts,
    ...input.candidate.skills,
    ...input.candidate.experience.flatMap((item) => item.achievements),
    ...input.candidate.education,
    ...input.candidate.certifications,
  ].join(' ').toLowerCase();
  const jobKeywords = keywords(input.job_description);
  const matched = jobKeywords.filter((word) => evidence.includes(word));
  const notEvidenced = jobKeywords.filter((word) => !evidence.includes(word));
  const summary = input.candidate.professional_summary_facts.join(' ');
  const lines = resumeText(input, summary);
  const [docx, pdf] = await Promise.all([makeDocx(lines), makePdf(lines)]);
  const firstEvidence = input.candidate.experience[0]!.achievements[0]!;
  const organization = input.target_organization ?? 'your organization';
  const coverLetter = input.preferences.include_cover_letter
    ? `Dear Hiring Team,\n\nI am applying for the ${input.target_role} role at ${organization}. ${summary}\n\nOne example I would bring to this role is: ${firstEvidence}\n\nI would welcome the opportunity to discuss how this evidence relates to your priorities.\n\nSincerely,\n${input.candidate.name}`
    : null;
  const output: CareerPackOutput = {
    service: 'KeepFlow Work & Career - Career Pack',
    target_role: input.target_role,
    resume: {
      headline: input.target_role,
      summary,
      skills: input.candidate.skills,
      experience: input.candidate.experience,
      education: input.candidate.education,
      certifications: input.candidate.certifications,
    },
    cover_letter: coverLetter,
    keyword_analysis: {
      matched,
      not_evidenced: notEvidenced,
      notice: 'This is a transparent keyword comparison, not an ATS score or guarantee. Add a missing term only when your real experience supports it.',
    },
    interview_prep: input.preferences.include_interview_prep ? [
      { question: `Why are you a strong fit for ${input.target_role}?`, evidence_to_use: summary },
      { question: 'Describe a relevant result you delivered.', evidence_to_use: firstEvidence },
      { question: 'Which capability would you strengthen first in this role?', evidence_to_use: notEvidenced[0] ? `Discuss ${notEvidenced[0]} honestly and explain your learning plan.` : 'Choose a genuine development area and explain your plan.' },
    ] : [],
    artifacts: {
      resume_docx: artifact('keepflow-resume.docx', DOCX_MIME, docx),
      resume_pdf: artifact('keepflow-resume.pdf', 'application/pdf', pdf),
    },
    questions: notEvidenced.slice(0, 5).map((word) => `Do you have verifiable experience with “${word}” that should be added?`),
    limitations: [
      'KeepFlow uses only the facts supplied by the caller and does not verify employment or education claims.',
      'Compatibility with a specific employer or applicant-tracking system cannot be guaranteed.',
    ],
    meta: { asp: 'KeepFlow', schema_version: '1.0.0', generated_at: new Date().toISOString(), claims_invented: false, stores_payload: false },
  };
  return CareerPackOutputSchema.parse(output);
}

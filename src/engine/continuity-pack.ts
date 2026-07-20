import { createHash } from 'node:crypto';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import type {
  ContinuityPackInput,
  ContinuityResource,
} from '../schemas/continuity-pack-input.js';
import {
  ContinuityPackOutputSchema,
  type ContinuityAction,
  type ContinuityPackOutput,
} from '../schemas/continuity-pack-output.js';
import type { StudyAssistPersonalDataCategory } from '../security/study-assist-guard.js';
import { buildReminderPack, validateReminderPack } from './reminder-pack.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const NAVY = '10182C';
const TEAL = '19B8B0';
const INK = '253330';
const MUTED = '62706E';
const PALE = 'E8F6F4';

type WindowName = 'next_15_minutes' | 'today' | 'next_seven_days';

interface ActionDraft {
  window: WindowName;
  action: string;
  why: string;
  requires?: ContinuityResource[];
  completion: string;
}

interface ContinuityPlan {
  firstSafeMove: string;
  timeline: Record<WindowName, ContinuityAction[]>;
  messages: ContinuityPackOutput['ready_to_send_messages'];
  delegationCards: ContinuityPackOutput['delegation_cards'];
  questions: string[];
}

const RESOURCE_LABELS: Record<ContinuityResource, string> = {
  safe_place: 'safe place',
  another_device: 'another trusted device',
  borrowed_phone: 'borrowed phone',
  internet: 'internet access',
  money: 'money or payment access',
  identification: 'identification',
  trusted_person: 'trusted person',
  transport: 'transport',
};

function alternativeFor(
  resource: ContinuityResource,
  input: ContinuityPackInput,
): string {
  const available = input.access;
  switch (resource) {
    case 'safe_place':
      return 'Move toward staffed public help such as reception, security, a transport desk, police station, clinic, or other verified local authority; call local emergency services if there is immediate danger.';
    case 'another_device':
      if (available.borrowed_phone === 'available') {
        return 'Use the borrowed phone only for verified provider numbers; avoid saving passwords and sign out when finished.';
      }
      if (available.trusted_person === 'available') {
        return 'Ask the trusted person to place calls or locate verified in-person help without sharing passwords, PINs, OTPs, recovery codes, or private keys.';
      }
      return 'Use an in-person provider branch, carrier store, accommodation desk, transport desk, embassy/consulate, police station, or other verified local service point.';
    case 'borrowed_phone':
      if (available.another_device === 'available') {
        return 'Use the other trusted device and verify provider websites independently.';
      }
      return 'Use an in-person service point or ask verified staff to help place a call; do not reveal passwords, PINs, OTPs, recovery codes, or private keys.';
    case 'internet':
      if (available.borrowed_phone === 'available' || available.another_device === 'available') {
        return 'Use the available trusted connection only after independently checking the provider destination.';
      }
      return 'Use verified in-person support. Avoid entering sensitive credentials on public computers or unknown Wi-Fi.';
    case 'money':
      if (available.trusted_person === 'available') {
        return 'Ask the trusted person to arrange a small, traceable emergency payment directly to the verified provider rather than sending cash or credentials.';
      }
      return 'Explain the loss in person to the accommodation, transport provider, embassy/consulate, bank, or local authority and ask what documented emergency options are actually available.';
    case 'identification':
      return 'Use any safe copy, booking reference, police report number, or provider reference you already have and ask the relevant authority which alternative proof it accepts; do not assume a copy guarantees service.';
    case 'trusted_person':
      return 'Use verified staffed help such as accommodation reception, transport staff, an embassy/consulate, police, local authority, employer, or school welfare service.';
    case 'transport':
      return 'Stay at the nearest staffed safe location and ask verified local staff or authorities for the safest available route; do not accept unverified rides.';
  }
}

function materializeAction(
  draft: ActionDraft,
  index: number,
  input: ContinuityPackInput,
): ContinuityAction & { window: WindowName } {
  const requires = draft.requires ?? [];
  const alternatives = requires
    .filter((resource) => input.access[resource] !== 'available')
    .map((resource) => ({ resource, route: alternativeFor(resource, input) }));
  return {
    window: draft.window,
    id: `A${String(index + 1).padStart(2, '0')}`,
    priority: index + 1,
    action: draft.action,
    why: draft.why,
    requires,
    alternatives,
    completion_evidence: draft.completion,
  };
}

function universalActions(input: ContinuityPackInput): ActionDraft[] {
  return [
    {
      window: 'next_15_minutes',
      action: 'Get to a staffed safe place and pause before sharing information or accepting help.',
      why: 'Physical safety and a controlled environment come before account, document, travel, work, or study recovery.',
      requires: ['safe_place'],
      completion: 'You can name the staffed place you are using and the next verified contact you intend to make.',
    },
    {
      window: 'today',
      action: 'Create a short incident record with the approximate time, place, affected items, and every provider reference number.',
      why: 'A single record prevents contradictory retelling and helps with provider, insurer, employer, school, or authority follow-up.',
      requires: input.access.another_device === 'available' ? ['another_device'] : [],
      completion: 'One written record exists without passwords, PINs, OTPs, recovery codes, seed phrases, or private keys.',
    },
    {
      window: 'next_seven_days',
      action: 'Review every temporary workaround and replace it with a durable arrangement.',
      why: 'Borrowed access, temporary cards, provisional documents, and verbal promises can quietly become new failure points.',
      completion: 'Each temporary measure is either closed, replaced, or assigned a dated follow-up.',
    },
  ];
}

function scenarioActions(input: ContinuityPackInput): ActionDraft[] {
  switch (input.situation_type) {
    case 'stolen_phone_or_wallet':
      return [
        {
          window: 'next_15_minutes',
          action: 'Contact card providers through a verified number or in person and freeze or block the missing payment methods.',
          why: 'Stopping usable payment instruments limits immediate financial loss before longer recovery work.',
          requires: ['borrowed_phone', 'identification'],
          completion: 'Each affected provider gives a freeze/block confirmation or a reference number.',
        },
        {
          window: 'next_15_minutes',
          action: 'Contact the mobile carrier through a verified route and ask it to suspend the missing SIM or line while preserving the number if possible.',
          why: 'A live SIM can expose calls, texts, and account-recovery channels.',
          requires: ['borrowed_phone', 'identification'],
          completion: 'The carrier confirms the line state and gives a support reference.',
        },
        {
          window: 'today',
          action: 'From a trusted device, secure the primary email and other high-impact accounts, review sessions, and replace recovery paths tied to the missing phone.',
          why: 'Primary email and phone recovery channels can unlock many downstream accounts.',
          requires: ['another_device', 'internet'],
          completion: 'High-impact accounts have reviewed sessions and known-good recovery methods; credentials were not entered on a public computer.',
        },
        {
          window: 'today',
          action: 'File the appropriate loss or theft report and preserve the report or reference number.',
          why: 'Providers, insurers, employers, schools, or authorities may ask for an official record.',
          requires: ['transport', 'identification'],
          completion: 'A report/reference number and issuing authority are recorded.',
        },
        {
          window: 'next_seven_days',
          action: 'Replace affected cards, identification, SIM access, and authentication methods in dependency order.',
          why: 'Replacement without reviewing dependencies can recreate the same lockout.',
          requires: ['identification', 'money', 'transport'],
          completion: 'Every replacement has an owner, status, and next follow-up date.',
        },
        {
          window: 'next_seven_days',
          action: 'Review account activity and dispute only transactions you do not recognize through the provider process.',
          why: 'Early review helps identify continuing misuse and creates a traceable provider record.',
          requires: ['another_device', 'internet'],
          completion: 'Activity was reviewed and any unrecognized item has a provider case reference.',
        },
      ];
    case 'lost_documents':
      return [
        {
          window: 'next_15_minutes',
          action: 'List exactly which documents are missing and separate confirmed loss from uncertainty.',
          why: 'Replacement and reporting paths depend on the document type and whether it may still be recoverable.',
          completion: 'A confirmed/maybe-safe inventory exists.',
        },
        {
          window: 'today',
          action: 'Contact the issuing authority, embassy/consulate, or verified local authority for the correct report and emergency-document process.',
          why: 'Document rules vary by country and issuer; verified authorities are the source of truth.',
          requires: ['borrowed_phone', 'transport'],
          completion: 'The correct authority, required evidence, appointment route, and reference number are recorded.',
        },
        {
          window: 'today',
          action: 'Notify accommodation and transport providers of the documented disruption and ask what verified alternatives they accept.',
          why: 'Early notice creates time to resolve identity and booking constraints before departure or check-in.',
          requires: ['borrowed_phone', 'identification'],
          completion: 'Each affected booking has a named next step or provider reference.',
        },
        {
          window: 'next_seven_days',
          action: 'Complete permanent replacement and monitor for misuse of the missing documents.',
          why: 'Emergency documents solve only the immediate gap and may not address identity misuse.',
          requires: ['money', 'transport', 'identification'],
          completion: 'Permanent replacement and any issuer-recommended monitoring are underway.',
        },
      ];
    case 'travel_disruption':
      return [
        {
          window: 'next_15_minutes',
          action: 'Confirm the disruption directly with the transport or accommodation provider and request a written status or reference.',
          why: 'Verified status prevents decisions based on rumours, stale screens, or unofficial messages.',
          requires: ['borrowed_phone'],
          completion: 'A current provider status and reference are recorded.',
        },
        {
          window: 'today',
          action: 'Secure the safest realistic place to wait or sleep before pursuing the cheapest option.',
          why: 'Fatigue and unsafe waiting conditions increase decision and personal-safety risk.',
          requires: ['money', 'transport'],
          completion: 'A verified safe waiting or overnight arrangement is confirmed.',
        },
        {
          window: 'today',
          action: 'Notify people affected by the delay using the ready-to-send message and give only confirmed facts.',
          why: 'Early, bounded communication protects work, study, family, and booking continuity.',
          requires: ['borrowed_phone'],
          completion: 'Affected people have a confirmed update and next update time.',
        },
        {
          window: 'next_seven_days',
          action: 'Preserve receipts and submit eligible provider or insurer claims using their verified rules.',
          why: 'Claims often depend on documentation and deadlines rather than the disruption alone.',
          requires: ['another_device', 'internet'],
          completion: 'Receipts are organized and each eligible claim has a status or reference.',
        },
      ];
    case 'account_access_disruption':
      return [
        {
          window: 'next_15_minutes',
          action: 'Use a trusted device or verified in-person support to protect the primary email and recovery channels first.',
          why: 'Primary recovery channels can control many downstream accounts.',
          requires: ['another_device', 'internet'],
          completion: 'Primary recovery channels have known-good access or an official recovery case.',
        },
        {
          window: 'today',
          action: 'Review active sessions and recovery methods, then revoke only sessions you do not recognize.',
          why: 'Removing unknown access limits continuing misuse without pretending every session is malicious.',
          requires: ['another_device', 'internet'],
          completion: 'Session review and recovery-method review are documented.',
        },
        {
          window: 'today',
          action: 'Contact the provider through its verified recovery route and preserve the case reference.',
          why: 'A traceable case is safer than acting on unsolicited recovery messages.',
          requires: ['borrowed_phone', 'identification'],
          completion: 'An official case reference and next checkpoint exist.',
        },
        {
          window: 'next_seven_days',
          action: 'Rebuild authentication and backup recovery methods after access is stable.',
          why: 'Recovery is incomplete if it depends on one device, one phone number, or one untested backup.',
          requires: ['another_device', 'internet'],
          completion: 'Recovery methods are current and a non-sensitive recovery test is complete.',
        },
      ];
    case 'home_disruption':
      return [
        {
          window: 'next_15_minutes',
          action: 'Leave or avoid any unsafe area and contact the appropriate verified emergency or property service.',
          why: 'Personal safety and hazard control come before belongings or cleanup.',
          requires: ['safe_place', 'borrowed_phone'],
          completion: 'You are at a safe location and the correct service has acknowledged the incident.',
        },
        {
          window: 'today',
          action: 'Arrange essential shelter, medication, food, charging, and transport for the next night.',
          why: 'Continuity depends on stabilizing basic needs before administrative work.',
          requires: ['money', 'transport', 'trusted_person'],
          completion: 'Tonight\'s safe arrangement and essential-needs plan are confirmed.',
        },
        {
          window: 'today',
          action: 'Document damage only when safe and notify the landlord, insurer, employer, or school as relevant.',
          why: 'A timely factual record supports repairs, claims, and deadline flexibility.',
          requires: ['another_device'],
          completion: 'Photos/notes and provider references exist without entering an unsafe area.',
        },
        {
          window: 'next_seven_days',
          action: 'Turn temporary shelter, repairs, claims, and missed obligations into dated owners and checkpoints.',
          why: 'Longer recovery fails when temporary promises have no owner or follow-up date.',
          completion: 'Every open item has an owner, status, and next date.',
        },
      ];
    case 'work_or_study_disruption':
      return [
        {
          window: 'next_15_minutes',
          action: 'Identify the single deadline or responsibility most likely to cause irreversible harm if missed.',
          why: 'Triage protects the highest-impact obligation before rebuilding the full schedule.',
          completion: 'One priority and its real deadline are written down.',
        },
        {
          window: 'today',
          action: 'Send a factual continuity notice to the employer or school with the impact, safe workaround, and next update time.',
          why: 'Early bounded communication creates options without oversharing personal information.',
          requires: ['borrowed_phone'],
          completion: 'The relevant person has the update and an agreed checkpoint or acknowledgment.',
        },
        {
          window: 'today',
          action: 'Recover only the tools and files needed for the highest-priority obligation using approved access routes.',
          why: 'Restoring everything at once wastes scarce time and can encourage unsafe access shortcuts.',
          requires: ['another_device', 'internet'],
          completion: 'The minimum approved toolset for the priority obligation is working or formally escalated.',
        },
        {
          window: 'next_seven_days',
          action: 'Rebuild the execution plan around confirmed capacity and record every changed commitment.',
          why: 'A revised plan is credible only when owners and dates reflect the disruption.',
          completion: 'The revised schedule is shared and every changed commitment is acknowledged.',
        },
      ];
    case 'other':
      return [
        {
          window: 'next_15_minutes',
          action: 'Separate immediate safety, irreversible loss, exploitable access, and deadline risks before acting.',
          why: 'A general disruption needs explicit triage so urgency is not confused with importance.',
          completion: 'Each risk class is marked present, absent, or unknown.',
        },
        {
          window: 'today',
          action: 'Contact the verified provider or authority responsible for the highest confirmed risk and preserve its reference.',
          why: 'Verified ownership prevents random escalation and creates a traceable next step.',
          requires: ['borrowed_phone'],
          completion: 'One responsible provider and one reference or appointment are recorded.',
        },
        {
          window: 'today',
          action: 'Use the ready-to-send update to protect affected family, work, study, travel, or home commitments.',
          why: 'Continuity includes the people and obligations affected by the disruption.',
          requires: ['borrowed_phone'],
          completion: 'Affected people know the confirmed impact and next update time.',
        },
        {
          window: 'next_seven_days',
          action: 'Convert every unresolved item into an owner, dated checkpoint, and acceptable completion proof.',
          why: 'Ambiguous follow-up is where temporary disruption becomes prolonged failure.',
          completion: 'No open item lacks an owner and next date.',
        },
      ];
  }
}

function deliveryRoutes(input: ContinuityPackInput): Array<'another_device' | 'borrowed_phone' | 'trusted_person' | 'in_person'> {
  const routes: Array<'another_device' | 'borrowed_phone' | 'trusted_person' | 'in_person'> = [];
  if (input.access.another_device === 'available') routes.push('another_device');
  if (input.access.borrowed_phone === 'available') routes.push('borrowed_phone');
  if (input.access.trusted_person === 'available') routes.push('trusted_person');
  routes.push('in_person');
  return routes;
}

function buildMessages(input: ContinuityPackInput): ContinuityPlan['messages'] {
  const selected = input.stakeholders.length > 0
    ? input.stakeholders
    : ['family_or_friend', 'employer_or_school'] as const;
  const routes = deliveryRoutes(input);
  const location = [input.location.city_or_area, input.location.country]
    .filter((value): value is string => Boolean(value))
    .join(', ');
  const safeLocation = location || 'the location described in this request';
  const situationSummary = input.description.replace(/\s+/g, ' ').trim();
  const boundedSituation = situationSummary.length > 220
    ? `${situationSummary.slice(0, 217)}...`
    : situationSummary;
  const practicalHelp = input.access.trusted_person === 'available'
    ? 'locating the verified contact route and nearest staffed service point for the highest-priority provider'
    : 'recording my next safe checkpoint and helping me reach a verified staffed service point';
  const completionCheck = 'the provider case, appointment, or report reference';
  return selected.map((recipient, index) => {
    const bodyByRecipient: Record<typeof recipient, string> = {
      bank_or_card_provider: 'My phone and/or wallet is unavailable after a loss or theft. Please freeze the affected payment access, tell me what identity checks you accept through this verified channel, and give me a case reference. I will not provide a PIN, OTP, password, recovery code, seed phrase, or private key.',
      mobile_carrier: 'My phone is unavailable after a loss or theft. Please suspend the affected SIM or line, preserve the number if your process allows, explain the verified replacement steps, and give me a support reference. I will not provide passwords or one-time codes to an unsolicited contact.',
      accommodation_or_transport: `I am dealing with an unexpected disruption in ${safeLocation}. Please record that my access to the confirmed booking or journey may be affected, explain the verified alternatives you accept, and provide a written reference or next update time. I will share only the minimum non-secret booking details through your verified channel.`,
      employer_or_school: `I am safe, but an unexpected disruption is affecting my access and timing. The confirmed situation is: ${boundedSituation} My safest workable next step is to protect urgent access and notify affected people through verified channels. Please confirm the priority I should protect first and the next reasonable update time.`,
      family_or_friend: `I am safe, but I have had a serious disruption and may have limited phone, money, identification, or transport access. Please do not send money or information to an unverified request. I need help with ${practicalHelp}, and I will confirm completion using ${completionCheck}.`,
      embassy_or_consulate: `I am in ${safeLocation}, and my travel or identity documents may be unavailable. Please explain the official report, identity evidence, appointment, fee, and emergency-document process that applies. I need a case or appointment reference and will not share passwords or one-time codes.`,
      police_or_local_authority: `I need to report the following loss, theft, safety, or document incident in ${safeLocation}: ${boundedSituation} Please tell me the correct reporting route and provide a report or reference number. I will provide exact times and affected-item details only through the verified reporting channel.`,
    };
    return {
      id: `M${String(index + 1).padStart(2, '0')}`,
      recipient,
      subject: `Continuity update: ${recipient.replaceAll('_', ' ')}`,
      message: bodyByRecipient[recipient],
      delivery_routes: routes,
    };
  });
}

function buildDelegationCards(input: ContinuityPackInput): ContinuityPlan['delegationCards'] {
  const primaryRole = input.access.trusted_person === 'available'
    ? 'Trusted person'
    : 'Verified staffed service desk or local authority';
  return [
    {
      id: 'D01',
      delegate_role: primaryRole,
      task: 'Locate the verified public contact route, opening hours, and nearest safe in-person service point for the highest-priority provider.',
      share_only: ['Provider class', 'country/city context', 'non-sensitive booking or case reference if required'],
      never_share: ['passwords or PINs', 'OTP or recovery codes', 'seed phrases or private keys', 'full payment-card details'],
      completion_proof: 'Return the verified source, contact route, opening hours, and any appointment requirement; do not claim the provider completed an action.',
    },
    {
      id: 'D02',
      delegate_role: 'Trusted person or authorized workplace/school contact',
      task: 'Send the bounded continuity update and record who acknowledged it and the next update time.',
      share_only: ['confirmed impact', 'requested practical help', 'next update time'],
      never_share: ['credentials', 'unnecessary medical or identity details', 'unverified claims'],
      completion_proof: 'Provide the acknowledgment and agreed checkpoint without adding private details to the shared record.',
    },
  ];
}

export function buildContinuityPlan(input: ContinuityPackInput): ContinuityPlan {
  const windowOrder: Record<WindowName, number> = {
    next_15_minutes: 0,
    today: 1,
    next_seven_days: 2,
  };
  const drafts = [...universalActions(input), ...scenarioActions(input)]
    .sort((left, right) => windowOrder[left.window] - windowOrder[right.window]);
  const actions = drafts.map((draft, index) => materializeAction(draft, index, input));
  const withoutWindow = ({
    window: _window,
    ...action
  }: ContinuityAction & { window: WindowName }): ContinuityAction => action;
  const timeline: ContinuityPlan['timeline'] = {
    next_15_minutes: actions
      .filter((action) => action.window === 'next_15_minutes')
      .map(withoutWindow),
    today: actions.filter((action) => action.window === 'today').map(withoutWindow),
    next_seven_days: actions
      .filter((action) => action.window === 'next_seven_days')
      .map(withoutWindow),
  };
  const questions = Object.entries(input.access)
    .filter(([, state]) => state === 'unknown')
    .slice(0, 5)
    .map(([resource]) => `Can you confirm whether ${RESOURCE_LABELS[resource as ContinuityResource]} is available?`);
  if (input.situation_type === 'other') {
    questions.unshift('What single outcome would cause irreversible harm if it is not handled today?');
  }
  return {
    firstSafeMove: timeline.next_15_minutes[0]!.action,
    timeline,
    messages: buildMessages(input),
    delegationCards: buildDelegationCards(input),
    questions: questions.slice(0, 6),
  };
}

export function validateContinuityPlan(
  plan: ContinuityPlan,
  input: ContinuityPackInput,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const allActions = [
    ...plan.timeline.next_15_minutes,
    ...plan.timeline.today,
    ...plan.timeline.next_seven_days,
  ];
  const ids = new Set<string>();
  allActions.forEach((action) => {
    if (ids.has(action.id)) errors.push(`duplicate action id ${action.id}`);
    ids.add(action.id);
    action.requires.forEach((resource) => {
      if (
        input.access[resource] !== 'available' &&
        !action.alternatives.some((alternative) => alternative.resource === resource)
      ) {
        errors.push(`${action.id} depends on unavailable or unknown ${resource} without an alternative`);
      }
    });
  });
  if (allActions.length < 6) errors.push('continuity plan must contain at least six actions');
  if (plan.messages.length < 1) errors.push('continuity plan must contain a message');
  if (plan.delegationCards.length < 1) errors.push('continuity plan must contain a delegation card');
  return { valid: errors.length === 0, errors };
}

function titleCase(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\b(?:And|Or|Of|From|To)\b/g, (word, offset: number) =>
      offset === 0 ? word : word.toLowerCase());
}

function docxActionChildren(action: ContinuityAction): Paragraph[] {
  const paragraphs = [
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      keepNext: true,
      children: [new TextRun({ text: `${action.id}  ${action.action}`, bold: true })],
    }),
    new Paragraph({
      keepNext: true,
      children: [
        new TextRun({ text: 'Why: ', bold: true, color: NAVY }),
        new TextRun(action.why),
      ],
    }),
  ];
  action.alternatives.forEach((alternative) => {
    paragraphs.push(new Paragraph({
      keepNext: true,
      children: [
        new TextRun({ text: `If ${RESOURCE_LABELS[alternative.resource]} is not available: `, bold: true, color: '8A5A00' }),
        new TextRun(alternative.route),
      ],
    }));
  });
  paragraphs.push(new Paragraph({
    keepLines: true,
    spacing: { after: 140 },
    children: [
      new TextRun({ text: 'Done when: ', bold: true, color: NAVY }),
      new TextRun(action.completion_evidence),
    ],
  }));
  return paragraphs;
}

function buildMetadataTable(input: ContinuityPackInput): Table {
  const location = [input.location.city_or_area, input.location.country].filter(Boolean).join(', ');
  const cells = [
    ['Situation', titleCase(input.situation_type)],
    ['Location', location],
    ['Away from home', input.location.away_from_home ? 'Yes' : 'No'],
    ['Timezone', input.timezone],
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2200, 7160],
    rows: cells.map(([label, value]) => new TableRow({
      children: [
        new TableCell({
          width: { size: 2200, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: PALE },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: label!, bold: true, color: NAVY })] })],
        }),
        new TableCell({
          width: { size: 7160, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph(value!)],
        }),
      ],
    })),
  });
}

async function renderContinuityDocx(
  input: ContinuityPackInput,
  plan: ContinuityPlan,
  generatedAt: Date,
): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      spacing: { after: 0 },
      children: [new TextRun({ text: 'KEEPFLOW CONTINUITY PACK', bold: true, color: TEAL, size: 20 })],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: 'Your next safe move, organized for action', bold: true, color: NAVY, size: 40 })],
    }),
    new Paragraph({
      spacing: { after: 280 },
      children: [new TextRun({
        text: 'Access-aware actions, ready-to-send messages, delegated tasks, and importable reminders.',
        color: MUTED,
        size: 24,
      })],
    }),
    buildMetadataTable(input),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('First safe move')],
    }),
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: PALE },
      border: {
        left: { style: BorderStyle.SINGLE, size: 18, color: TEAL },
      },
      indent: { left: 220, right: 120 },
      spacing: { before: 80, after: 180 },
      children: [new TextRun({ text: plan.firstSafeMove, bold: true, color: NAVY })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Access snapshot')],
    }),
  ];

  Object.entries(input.access).forEach(([resource, state]) => {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${titleCase(resource)}: `, bold: true, color: NAVY }),
        new TextRun({ text: titleCase(state), color: state === 'available' ? '176B5B' : state === 'unavailable' ? '9B1C1C' : '8A5A00' }),
      ],
    }));
  });

  const windows: Array<[WindowName, string]> = [
    ['next_15_minutes', 'Next 15 minutes'],
    ['today', 'Today'],
    ['next_seven_days', 'Next seven days'],
  ];
  windows.forEach(([window, label]) => {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(label)] }));
    plan.timeline[window].forEach((action) => children.push(...docxActionChildren(action)));
  });

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Ready-to-send messages')] }));
  plan.messages.forEach((message) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        keepNext: true,
        children: [new TextRun(`${message.id}  ${titleCase(message.recipient)}`)],
      }),
      new Paragraph({
        keepNext: true,
        children: [new TextRun({ text: `Subject: ${message.subject}`, bold: true })],
      }),
      new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: 'F4F6F9' },
        indent: { left: 180, right: 120 },
        spacing: { before: 60, after: 160 },
        children: [new TextRun(message.message)],
      }),
    );
  });

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Delegation cards')] }));
  plan.delegationCards.forEach((card) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        keepNext: true,
        children: [new TextRun(`${card.id}  ${card.delegate_role}`)],
      }),
      new Paragraph({ keepNext: true, children: [new TextRun({ text: 'Task: ', bold: true, color: NAVY }), new TextRun(card.task)] }),
      new Paragraph({ keepNext: true, children: [new TextRun({ text: 'Share only: ', bold: true, color: NAVY }), new TextRun(card.share_only.join('; '))] }),
      new Paragraph({ keepNext: true, children: [new TextRun({ text: 'Never share: ', bold: true, color: '9B1C1C' }), new TextRun(card.never_share.join('; '))] }),
      new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'Done when: ', bold: true, color: NAVY }), new TextRun(card.completion_proof)] }),
    );
  });

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Calendar and review')] }),
    new Paragraph('The accompanying .ics file contains practical checkpoints derived from this pack. Review the dates, timezone, and notification permissions before importing it.'),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Important boundaries')] }),
    new Paragraph('KeepFlow does not contact providers, send messages, store this file, run background reminders, or guarantee that a provider or authority will accept a particular alternative. Verify official contacts and local emergency information for the country you are in.'),
  );

  const doc = new Document({
    creator: 'KeepFlow',
    title: 'KeepFlow Continuity Pack',
    description: 'Stateless access-aware continuity brief',
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: INK },
          paragraph: { spacing: { after: 120, line: 300 } },
        },
        heading1: {
          run: { font: 'Calibri', size: 32, bold: true, color: '2E74B5' },
          paragraph: { spacing: { before: 360, after: 200 }, keepNext: true },
        },
        heading2: {
          run: { font: 'Calibri', size: 26, bold: true, color: '2E74B5' },
          paragraph: { spacing: { before: 280, after: 140 }, keepNext: true },
        },
        heading3: {
          run: { font: 'Calibri', size: 24, bold: true, color: '1F4D78' },
          paragraph: { spacing: { before: 200, after: 100 }, keepNext: true },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12_240, height: 15_840 },
          margin: { top: 1_440, right: 1_440, bottom: 1_440, left: 1_440, header: 708, footer: 708 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'KEEPFLOW  |  CONTINUITY PACK', color: MUTED, size: 16 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `Generated ${generatedAt.toISOString()}  |  `, color: MUTED, size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
              new TextRun({ text: ' of ', color: MUTED, size: 16 }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], color: MUTED, size: 16 }),
              new TextRun({ text: '  |  Review before use', color: MUTED, size: 16 }),
            ],
          })],
        }),
      },
      children,
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

function ensurePdfSpace(doc: PDFKit.PDFDocument, height: number): void {
  if (doc.y + height > doc.page.height - 72) doc.addPage();
}

function pdfHeading(doc: PDFKit.PDFDocument, text: string, size = 17): void {
  ensurePdfSpace(doc, 48);
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(size).fillColor(`#${NAVY}`).text(text, { lineGap: 2 });
  doc.moveDown(0.25);
}

function pdfAction(doc: PDFKit.PDFDocument, action: ContinuityAction): void {
  ensurePdfSpace(doc, 120);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(`#${NAVY}`).text(`${action.id}  ${action.action}`, { lineGap: 2 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(`#${INK}`).text('Why: ', { continued: true });
  doc.font('Helvetica').text(action.why, { lineGap: 2 });
  action.alternatives.forEach((alternative) => {
    doc.font('Helvetica-Bold').fillColor('#8A5A00').text(`If ${RESOURCE_LABELS[alternative.resource]} is not available: `, { continued: true });
    doc.font('Helvetica').fillColor(`#${INK}`).text(alternative.route, { lineGap: 2 });
  });
  doc.font('Helvetica-Bold').fillColor(`#${NAVY}`).text('Done when: ', { continued: true });
  doc.font('Helvetica').fillColor(`#${INK}`).text(action.completion_evidence, { lineGap: 2 });
  doc.moveDown(0.45);
}

async function renderContinuityPdf(
  input: ContinuityPackInput,
  plan: ContinuityPlan,
  generatedAt: Date,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 58, right: 58, bottom: 62, left: 58 },
    bufferPages: true,
    info: {
      Title: 'KeepFlow Continuity Pack',
      Author: 'KeepFlow',
      Subject: 'Stateless access-aware continuity brief',
      CreationDate: generatedAt,
    },
  });
  const chunks: Buffer[] = [];
  const completion = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.rect(0, 0, doc.page.width, 10).fill(`#${TEAL}`);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(`#${TEAL}`).text('KEEPFLOW CONTINUITY PACK');
  doc.moveDown(0.7).font('Helvetica-Bold').fontSize(25).fillColor(`#${NAVY}`).text('Your next safe move, organized for action', { lineGap: 3 });
  doc.moveDown(0.45).font('Helvetica').fontSize(11.5).fillColor(`#${MUTED}`).text('Access-aware actions, ready-to-send messages, delegated tasks, and importable reminders.', { lineGap: 3 });
  doc.moveDown(0.8);
  const location = [input.location.city_or_area, input.location.country].filter(Boolean).join(', ');
  const metadata = [
    ['Situation', titleCase(input.situation_type)],
    ['Location', location],
    ['Away from home', input.location.away_from_home ? 'Yes' : 'No'],
    ['Timezone', input.timezone],
  ];
  metadata.forEach(([label, value]) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(`#${NAVY}`).text(`${label}: `, { continued: true });
    doc.font('Helvetica').fillColor(`#${INK}`).text(value!);
  });

  pdfHeading(doc, 'First safe move');
  const calloutY = doc.y;
  const calloutHeight = doc.heightOfString(plan.firstSafeMove, { width: 455, lineGap: 3 }) + 24;
  doc.roundedRect(58, calloutY, 496, calloutHeight, 5).fill(`#${PALE}`);
  doc.rect(58, calloutY, 5, calloutHeight).fill(`#${TEAL}`);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(`#${NAVY}`).text(plan.firstSafeMove, 74, calloutY + 12, { width: 465, lineGap: 3 });
  doc.y = calloutY + calloutHeight + 6;

  pdfHeading(doc, 'Access snapshot');
  Object.entries(input.access).forEach(([resource, state]) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(`#${NAVY}`).text(`${titleCase(resource)}: `, { continued: true });
    doc.font('Helvetica').fillColor(state === 'available' ? '#176B5B' : state === 'unavailable' ? '#9B1C1C' : '#8A5A00').text(titleCase(state));
  });

  const windows: Array<[WindowName, string]> = [
    ['next_15_minutes', 'Next 15 minutes'],
    ['today', 'Today'],
    ['next_seven_days', 'Next seven days'],
  ];
  windows.forEach(([window, label]) => {
    pdfHeading(doc, label);
    plan.timeline[window].forEach((action) => pdfAction(doc, action));
  });

  pdfHeading(doc, 'Ready-to-send messages');
  plan.messages.forEach((message) => {
    ensurePdfSpace(doc, 120);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(`#${NAVY}`).text(`${message.id}  ${titleCase(message.recipient)}`);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(`#${INK}`).text(`Subject: ${message.subject}`);
    doc.moveDown(0.15).font('Helvetica').text(message.message, { lineGap: 3 });
    doc.moveDown(0.55);
  });

  pdfHeading(doc, 'Delegation cards');
  plan.delegationCards.forEach((card) => {
    ensurePdfSpace(doc, 135);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(`#${NAVY}`).text(`${card.id}  ${card.delegate_role}`);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(`#${INK}`).text('Task: ', { continued: true });
    doc.font('Helvetica').text(card.task, { lineGap: 2 });
    doc.font('Helvetica-Bold').fillColor(`#${NAVY}`).text('Share only: ', { continued: true });
    doc.font('Helvetica').fillColor(`#${INK}`).text(card.share_only.join('; '));
    doc.font('Helvetica-Bold').fillColor('#9B1C1C').text('Never share: ', { continued: true });
    doc.font('Helvetica').fillColor(`#${INK}`).text(card.never_share.join('; '));
    doc.font('Helvetica-Bold').fillColor(`#${NAVY}`).text('Done when: ', { continued: true });
    doc.font('Helvetica').fillColor(`#${INK}`).text(card.completion_proof, { lineGap: 2 });
    doc.moveDown(0.55);
  });

  pdfHeading(doc, 'Calendar and review');
  doc.font('Helvetica').fontSize(9).fillColor(`#${INK}`).text('The accompanying .ics file contains practical checkpoints derived from this pack. Review dates, timezone, and notification permissions before import.', { lineGap: 3 });
  doc.moveDown(0.4).font('Helvetica-Bold').fillColor(`#${NAVY}`).text('Important boundaries');
  doc.font('Helvetica').fillColor(`#${INK}`).text('KeepFlow does not contact providers, send messages, store this file, run background reminders, or guarantee that a provider or authority will accept a particular alternative. Verify official contacts and local emergency information for the country you are in.', { lineGap: 3 });

  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(`#${MUTED}`).text(
      `KEEPFLOW  |  CONTINUITY PACK  |  ${page + 1} of ${range.count}  |  Review before use`,
      58,
      doc.page.height - 38,
      { width: doc.page.width - 116, align: 'right', lineBreak: false },
    );
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return completion;
}

function buildContinuityCalendar(
  input: ContinuityPackInput,
  plan: ContinuityPlan,
  generatedAt: Date,
) {
  const base = generatedAt.getTime();
  const actions = [
    plan.timeline.next_15_minutes.at(-1),
    plan.timeline.today.at(-1),
    plan.timeline.next_seven_days.at(-1),
  ].filter((action): action is ContinuityAction => Boolean(action));
  const offsets = [30, 6 * 60, 3 * 24 * 60];
  const events = actions.map((action, index) => ({
    id: `continuity-${index + 1}`,
    title: `KeepFlow checkpoint: ${action.action.slice(0, 90)}`,
    starts_at: new Date(base + offsets[index]! * 60_000).toISOString(),
    duration_minutes: 30,
    alert_minutes_before: index === 0 ? 10 : 30,
    note: `Completion evidence: ${action.completion_evidence}`,
    source_service: 'custom' as const,
  }));
  input.immediate_deadlines.forEach((deadline, index) => {
    events.push({
      id: `deadline-${deadline.id}`,
      title: `KeepFlow deadline: ${deadline.label}`,
      starts_at: deadline.due_at,
      duration_minutes: 30,
      alert_minutes_before: 60,
      note: 'Customer-supplied deadline. Confirm the time and timezone before relying on it.',
      source_service: 'custom' as const,
    });
  });
  return buildReminderPack({
    calendar_name: 'KeepFlow Continuity Checkpoints',
    timezone: input.timezone,
    events,
  }, generatedAt);
}

async function inspectDocx(buffer: Buffer): Promise<void> {
  if (buffer.subarray(0, 2).toString('ascii') !== 'PK') throw new Error('DOCX is not an OOXML archive');
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const names = Object.keys(zip.files);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    if (!zip.file(required)) throw new Error(`DOCX is missing ${required}`);
  }
  if (names.some((name) => /vbaProject\.bin|externalLinks|embeddings\//i.test(name))) {
    throw new Error('DOCX contains a prohibited active or embedded component');
  }
  const rels = await Promise.all(
    names.filter((name) => name.endsWith('.rels')).map((name) => zip.file(name)!.async('text')),
  );
  if (rels.some((xml) => /TargetMode=["']External["']/i.test(xml))) {
    throw new Error('DOCX contains a prohibited external relationship');
  }
}

function inspectPdf(buffer: Buffer): void {
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('PDF header is invalid');
  if (!buffer.subarray(Math.max(0, buffer.length - 1_024)).toString('latin1').includes('%%EOF')) {
    throw new Error('PDF trailer is incomplete');
  }
  if (/\/JavaScript|\/JS\b|\/Launch|\/EmbeddedFile/i.test(buffer.toString('latin1'))) {
    throw new Error('PDF contains a prohibited active or embedded component');
  }
}

function artifactFile(
  filename: string,
  mimeType: string,
  buffer: Buffer,
) {
  if (buffer.length === 0 || buffer.length > MAX_ARTIFACT_BYTES) {
    throw new Error(`${filename} has an invalid size`);
  }
  return {
    filename,
    mime_type: mimeType,
    encoding: 'base64' as const,
    byte_length: buffer.length,
    content_base64: buffer.toString('base64'),
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function buildContinuityPack(
  input: ContinuityPackInput,
  personalDataMasked: StudyAssistPersonalDataCategory[] = [],
  generatedAt = new Date(),
): Promise<ContinuityPackOutput> {
  const plan = buildContinuityPlan(input);
  const planValidation = validateContinuityPlan(plan, input);
  if (!planValidation.valid) {
    throw new Error(`continuity plan failed validation: ${planValidation.errors.join('; ')}`);
  }
  const calendar = buildContinuityCalendar(input, plan, generatedAt);
  const calendarValidation = validateReminderPack(calendar);
  if (!calendarValidation.valid) {
    throw new Error(`continuity calendar failed validation: ${calendarValidation.errors.join('; ')}`);
  }
  const [docx, pdf] = await Promise.all([
    renderContinuityDocx(input, plan, generatedAt),
    renderContinuityPdf(input, plan, generatedAt),
  ]);
  await inspectDocx(docx);
  inspectPdf(pdf);

  const locationContext = [input.location.city_or_area, input.location.country]
    .filter(Boolean)
    .join(', ');
  const output: ContinuityPackOutput = {
    service: 'KeepFlow Continuity Pack - Executable Life Continuity',
    situation_type: input.situation_type,
    location_context: locationContext,
    access_snapshot: { ...input.access },
    personal_data_masked: personalDataMasked,
    first_safe_move: plan.firstSafeMove,
    timeline: plan.timeline,
    ready_to_send_messages: plan.messages,
    delegation_cards: plan.delegationCards,
    questions_that_change_the_plan: plan.questions,
    artifacts: {
      calendar: artifactFile(calendar.calendar_file.filename, calendar.calendar_file.mime_type, Buffer.from(calendar.calendar_file.content_base64, 'base64')),
      printable_brief: artifactFile('keepflow-continuity-brief.pdf', 'application/pdf', pdf),
      editable_brief: artifactFile('keepflow-continuity-brief.docx', DOCX_MIME, docx),
    },
    quality: {
      schema_validated: true,
      access_constraints_validated: true,
      artifact_integrity_validated: true,
      reminders_included: true,
      credentials_rejected_before_payment: true,
    },
    limitations: [
      'KeepFlow organizes a continuity workflow but does not contact providers, authorities, employers, schools, or trusted people.',
      'Provider and authority requirements vary by country and can change; verify official contact routes and local emergency information.',
      'Calendar alerts work only after import and depend on the calendar application, device availability, permissions, dates, and timezone.',
      'The caller must review the PDF, DOCX, message scripts, delegation cards, and deadlines before relying on or sharing them.',
      'KeepFlow does not retain the generated files or the request after the response lifecycle ends.',
    ],
    meta: {
      asp: 'KeepFlow',
      schema_version: '1.0.0',
      generated_at: generatedAt.toISOString(),
      stateless: true,
      stores_files: false,
      sends_messages: false,
      sends_background_notifications: false,
    },
  };
  const parsed = ContinuityPackOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(`continuity output failed validation: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  for (const artifact of Object.values(parsed.data.artifacts)) {
    const decoded = Buffer.from(artifact.content_base64, 'base64');
    if (decoded.toString('base64') !== artifact.content_base64) {
      throw new Error(`${artifact.filename} is not canonical base64`);
    }
    if (decoded.length !== artifact.byte_length) throw new Error(`${artifact.filename} byte length mismatch`);
    if (createHash('sha256').update(decoded).digest('hex') !== artifact.sha256) {
      throw new Error(`${artifact.filename} digest mismatch`);
    }
  }
  return parsed.data;
}

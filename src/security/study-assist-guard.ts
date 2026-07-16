import { redactSecrets, type RedactionResult } from './redact-secrets.js';

export type StudyAssistRequestedAction =
  | 'learn_concepts'
  | 'summarize_material'
  | 'generate_practice'
  | 'draft_with_citation_guidance'
  | 'produce_submission'
  | 'take_live_assessment'
  | 'impersonate_learner';

export interface AcademicIntegrityDecision {
  requested_action: string;
  status: 'compliant' | 'redirected';
  learning_support_allowed: boolean;
  model_contact_allowed: boolean;
  /** Always false, including for draft_with_citation_guidance. */
  submission_generation_allowed: false;
  reason_code:
    | 'learning_support_only'
    | 'submission_production_blocked'
    | 'live_assessment_blocked'
    | 'learner_impersonation_blocked'
    | 'unsupported_action_blocked';
  safe_alternative: string;
}

const ALLOWED_ACTIONS = new Set<StudyAssistRequestedAction>([
  'learn_concepts',
  'summarize_material',
  'generate_practice',
  'draft_with_citation_guidance',
]);

const CONCEALED_SUBMISSION_PATTERNS = [
  /\b(?:do|write|complete|finish|produce|generate|solve)\s+(?:all\s+of\s+)?(?:my|the|this)\s+(?:graded\s+)?(?:homework|assignment|essay|coursework|submission|lab\s+report)\b/iu,
  /\b(?:give|provide)\s+me\s+(?:all\s+)?(?:the\s+)?answers\b/iu,
  /\b(?:make|turn)\s+(?:this|it)\s+(?:ready|final)\s+to\s+submit\b/iu,
  /(?:替我|帮我)(?:写|做).{0,20}(?:作业|论文|课程作业)/u,
  /\b(?:haz|escribe|completa)\s+(?:mi|el|la)\s+(?:tarea|ensayo|trabajo)\b/iu,
  /\b(?:fais|écris|termine)\s+(?:mon|ma|le|la)\s+(?:devoir|dissertation)\b/iu,
];

const CONCEALED_LIVE_ASSESSMENT_PATTERNS = [
  /\b(?:take|sit|answer|complete)\s+(?:my|the|this)\s+(?:(?:live|proctored|timed)\s+)?(?:exam|test|quiz)\s+for\s+me\b/iu,
  /\b(?:answer|help\s+me\s+answer)\s+(?:during|while\s+i\s+take)\s+(?:my|the|this)\s+(?:exam|test|quiz)\b/iu,
  /(?:替我|帮我)(?:考试|答题|参加测验)/u,
  /\b(?:haz|contesta)\s+(?:mi|el)\s+(?:examen|prueba)\s+por\s+m[ií]\b/iu,
];

const CONCEALED_IMPERSONATION_PATTERNS = [
  /\b(?:log\s*in|sign\s*in|submit|message|email)\s+(?:as|for)\s+me\b/iu,
  /\b(?:pretend|act)\s+to\s+be\s+me\b/iu,
  /(?:冒充我|以我的身份|替我登录|替我提交)/u,
  /\b(?:inicia\s+sesión|entrega|envía)\s+(?:como|por)\s+m[ií]\b/iu,
];

/**
 * Catch clear attempts to mislabel prohibited help as an allowed action. Only
 * trusted request fields should be passed here; uploaded course material is
 * evidence and may legitimately quote an assignment or assessment prompt.
 */
export function detectStudyAssistAcademicMisuse(
  trustedRequestText: readonly (string | null | undefined)[],
): Extract<StudyAssistRequestedAction, 'produce_submission' | 'take_live_assessment' | 'impersonate_learner'> | null {
  const text = trustedRequestText
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, ' ')
    .normalize('NFKC');
  if (CONCEALED_IMPERSONATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'impersonate_learner';
  }
  if (CONCEALED_LIVE_ASSESSMENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'take_live_assessment';
  }
  if (CONCEALED_SUBMISSION_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'produce_submission';
  }
  return null;
}

/**
 * Classify academic-integrity intent before any tutor/model call. Even an
 * allowed drafting request is limited to coaching, feedback, outlines, and
 * citation guidance: this guard never authorizes a submission-ready answer.
 */
export function classifyStudyAssistAcademicIntegrity(
  requestedAction: string,
): AcademicIntegrityDecision {
  if (ALLOWED_ACTIONS.has(requestedAction as StudyAssistRequestedAction)) {
    return {
      requested_action: requestedAction,
      status: 'compliant',
      learning_support_allowed: true,
      model_contact_allowed: true,
      submission_generation_allowed: false,
      reason_code: 'learning_support_only',
      safe_alternative:
        requestedAction === 'draft_with_citation_guidance'
          ? 'Provide an outline, citation guidance, questions, and feedback while the learner writes the submission.'
          : 'Provide explanations, summaries, and original practice that support the learner’s own work.',
    };
  }

  if (requestedAction === 'produce_submission') {
    return {
      requested_action: requestedAction,
      status: 'redirected',
      learning_support_allowed: false,
      model_contact_allowed: false,
      submission_generation_allowed: false,
      reason_code: 'submission_production_blocked',
      safe_alternative:
        'Help the learner understand the material, create an outline, locate citations, or review a learner-written draft.',
    };
  }

  if (requestedAction === 'take_live_assessment') {
    return {
      requested_action: requestedAction,
      status: 'redirected',
      learning_support_allowed: false,
      model_contact_allowed: false,
      submission_generation_allowed: false,
      reason_code: 'live_assessment_blocked',
      safe_alternative:
        'Create novel practice questions or explain concepts away from the live assessment.',
    };
  }

  if (requestedAction === 'impersonate_learner') {
    return {
      requested_action: requestedAction,
      status: 'redirected',
      learning_support_allowed: false,
      model_contact_allowed: false,
      submission_generation_allowed: false,
      reason_code: 'learner_impersonation_blocked',
      safe_alternative:
        'Coach the learner directly without logging in, communicating, or submitting work as them.',
    };
  }

  // Fail closed if a future caller bypasses the input schema with an unknown
  // value. This avoids silently expanding the allowed academic-help scope.
  return {
    requested_action: requestedAction,
    status: 'redirected',
    learning_support_allowed: false,
    model_contact_allowed: false,
    submission_generation_allowed: false,
    reason_code: 'unsupported_action_blocked',
    safe_alternative:
      'Choose concept learning, material summarization, original practice, or citation-guided drafting support.',
  };
}

export type SecretFindingCategory = keyof RedactionResult['findings'];

const SECRET_CATEGORY_ORDER: readonly SecretFindingCategory[] = [
  'mnemonic',
  'privateKeyHex',
  'cardNumber',
  'otpCode',
  'password',
  'apiToken',
  'bearerToken',
  'sshPrivateKey',
  'connectionString',
];

export interface StudyAssistSecretScanInput {
  title?: string | null;
  subject?: string | null;
  question?: string | null;
  topic?: string | null;
  output_language?: string | null;
  query?: string | null;
  extracted_chunks?: readonly string[] | null;
}

export interface StudyAssistSecretScanResult {
  detected: boolean;
  /** Category names only. No secret values, snippets, fields, or offsets. */
  categories: SecretFindingCategory[];
}

/**
 * Scan every model-bound Study Assist text field using the shared credential
 * detector. The result deliberately cannot carry the original or redacted
 * strings, preventing logging/caller code from accidentally echoing a secret.
 */
export function scanStudyAssistSecrets(
  input: StudyAssistSecretScanInput,
): StudyAssistSecretScanResult {
  const findings = new Set<SecretFindingCategory>();
  const values: string[] = [];

  for (const value of [
    input.title,
    input.subject,
    input.question,
    input.topic,
    input.output_language,
    input.query,
  ]) {
    if (typeof value === 'string' && value.length > 0) values.push(value);
  }
  if (Array.isArray(input.extracted_chunks)) {
    for (const chunk of input.extracted_chunks) {
      if (typeof chunk === 'string' && chunk.length > 0) values.push(chunk);
    }
  }

  for (const value of values) {
    const result = redactSecrets(value);
    for (const category of SECRET_CATEGORY_ORDER) {
      if (result.findings[category] > 0) findings.add(category);
    }
  }

  const categories = SECRET_CATEGORY_ORDER.filter((category) => findings.has(category));
  return { detected: categories.length > 0, categories };
}

export type StudyAssistPersonalDataCategory = 'email' | 'phone' | 'student_id';

export const STUDY_ASSIST_PERSON_NAME_LIMITATION =
  'Person names are not detected or masked; callers should remove names before external processing when required.';

export interface StudyAssistPersonalDataMaskResult {
  masked_text: string;
  categories: StudyAssistPersonalDataCategory[];
  person_name_detection_performed: false;
  limitation: typeof STUDY_ASSIST_PERSON_NAME_LIMITATION;
}

const MASK_CHARACTER = '█';

// Direct email addresses, including Unicode letters/digits in the local part
// and domain. Surrounding text is not consumed, so source offsets stay exact.
const EMAIL_RE =
  /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)+/gu;

const ZERO_WIDTH = '\\u200B-\\u200D\\u2060\\uFEFF';
const BETWEEN_LABEL_LETTERS = `[${ZERO_WIDTH}]*`;
const HORIZONTAL_SPACE = `\\t \\u00A0${ZERO_WIDTH}`;
const LABEL_GAP = `[${HORIZONTAL_SPACE}._-]*`;
const LABEL_TO_VALUE = `[${HORIZONTAL_SPACE}]*[:=#-]?[${HORIZONTAL_SPACE}]*`;

function separatedWord(word: string): string {
  return [...word].map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(BETWEEN_LABEL_LETTERS);
}

const PHONE_LABEL = [
  separatedWord('phone'),
  separatedWord('mobile'),
  separatedWord('telephone'),
  separatedWord('téléphone'),
  separatedWord('teléfono'),
  separatedWord('telefono'),
  separatedWord('tel'),
].join('|');

const PHONE_RE = new RegExp(
  `((?<![\\p{L}\\p{N}])(?:${PHONE_LABEL})(?:${LABEL_GAP}(?:no\\.?|number))?${LABEL_TO_VALUE})` +
    `([+\\p{Nd}().${HORIZONTAL_SPACE}-]{7,40})`,
  'giu',
);

const STUDENT_LABEL = [
  `${separatedWord('student')}${LABEL_GAP}(?:${separatedWord('id')}|no\\.?|number)`,
  `${separatedWord('learner')}${LABEL_GAP}${separatedWord('id')}`,
  `${separatedWord('matric')}${LABEL_GAP}(?:no\\.?|number|${separatedWord('id')})`,
  `${separatedWord('matriculation')}${LABEL_GAP}(?:no\\.?|number|${separatedWord('id')})`,
].join('|');

const STUDENT_ID_RE = new RegExp(
  `((?<![\\p{L}\\p{N}])(?:${STUDENT_LABEL})${LABEL_TO_VALUE}(?:is[${HORIZONTAL_SPACE}]+)?)` +
    `([\\p{L}\\p{N}][\\p{L}\\p{N}._/-]{2,63})`,
  'giu',
);

function sameLengthMask(value: string): string {
  // Iterating by Unicode code point prevents splitting surrogate pairs. A
  // two-code-unit character gets two one-unit mask characters, preserving the
  // UTF-16 offsets used by JavaScript string slicing and citation locators.
  let masked = '';
  for (const character of value) {
    masked += /\s/u.test(character) ? character : MASK_CHARACTER.repeat(character.length);
  }
  return masked;
}

/**
 * Mask a deliberately bounded set of direct identifiers without shifting any
 * source offsets. Labels and all text outside matched values remain unchanged;
 * whitespace inside matched values remains whitespace at the same indices.
 */
export function maskStudyAssistPersonalData(
  input: string,
): StudyAssistPersonalDataMaskResult {
  const found = new Set<StudyAssistPersonalDataCategory>();

  let masked = input.replace(EMAIL_RE, (value) => {
    found.add('email');
    return sameLengthMask(value);
  });

  masked = masked.replace(PHONE_RE, (full: string, label: string, value: string) => {
    const digitCount = [...value].filter((character) => /\p{Nd}/u.test(character)).length;
    if (digitCount < 7 || digitCount > 15) return full;
    found.add('phone');
    return `${label}${sameLengthMask(value)}`;
  });

  masked = masked.replace(
    STUDENT_ID_RE,
    (full: string, label: string, value: string) => {
      found.add('student_id');
      return `${label}${sameLengthMask(value)}`;
    },
  );

  const categories = (['email', 'phone', 'student_id'] as const).filter((category) =>
    found.has(category),
  );

  return {
    masked_text: masked,
    categories,
    person_name_detection_performed: false,
    limitation: STUDY_ASSIST_PERSON_NAME_LIMITATION,
  };
}

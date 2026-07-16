import { redactSecrets } from '../security/redact-secrets.js';
import {
  WorkHandoverInputSchema,
  type WorkHandoverInput,
} from '../schemas/work-handover-input.js';
import {
  WorkHandoverOutputSchema,
  type WorkHandoverOutput,
} from '../schemas/work-handover-output.js';

const RULE_SET_ID = 'keepflow-work/operational-handover' as const;
const RULE_SET_VERSION = '1.0.0';
const REDACTED = '[REDACTED_SECRET]';
const UNTRUSTED_INSTRUCTION = '[UNTRUSTED_INSTRUCTION_REMOVED]';

interface SecretPattern {
  category: string;
  pattern: RegExp;
  replacement: string;
}

// These supplement the shared First Move redactor. They deliberately cover
// common work-handover secrets that are not seed phrases or payment cards.
const WORK_SECRET_PATTERNS: SecretPattern[] = [
  {
    category: 'private_key_pem',
    pattern:
      /-----BEGIN (?:ENCRYPTED |OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:ENCRYPTED |OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/gi,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    category: 'connection_string',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi,
    replacement: '[REDACTED_CONNECTION_STRING]',
  },
  {
    category: 'bearer_token',
    pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replacement: `Bearer ${REDACTED}`,
  },
  {
    category: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: REDACTED,
  },
  {
    category: 'provider_token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/g,
    replacement: REDACTED,
  },
  {
    category: 'labeled_credential',
    pattern:
      /\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|secret[ _-]?key|authorization)\b\s*[:=]\s*["']?[^\s,"';]{8,}["']?/gi,
    replacement: REDACTED,
  },
];

export interface WorkHandoverPreflight {
  safe: boolean;
  sanitized: unknown;
  sensitive_categories: string[];
  blocked_category: 'credential_sharing' | 'security_bypass' | 'unauthorized_access' | 'destructive_concealment' | null;
  injection_like_text_detected: boolean;
}

function sanitizeText(value: string): { value: string; categories: string[] } {
  let safe = value;
  const categories: string[] = [];
  for (const item of WORK_SECRET_PATTERNS) {
    let matched = false;
    safe = safe.replace(item.pattern, () => {
      matched = true;
      return item.replacement;
    });
    item.pattern.lastIndex = 0;
    if (matched) categories.push(item.category);
  }

  const shared = redactSecrets(safe);
  safe = shared.redacted;
  for (const [category, count] of Object.entries(shared.findings)) {
    if (count > 0) categories.push(category);
  }
  return { value: safe, categories };
}

function sanitizeNested(value: unknown, categories: Set<string>): unknown {
  if (typeof value === 'string') {
    const result = sanitizeText(value);
    result.categories.forEach((category) => categories.add(category));
    return result.value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeNested(item, categories));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeNested(item, categories)]),
    );
  }
  return value;
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, output));
  }
  return output;
}

function neutralizeInstructionText(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(
        /\b(?:ignore|override|disregard)\b[^.!?\n]{0,160}\b(?:previous|system|developer|safety|instructions?|prompt)\b[^.!?\n]*/gi,
        UNTRUSTED_INSTRUCTION,
      )
      .replace(/\b(?:system|developer)\s+prompt\b[^.!?\n]*/gi, UNTRUSTED_INSTRUCTION);
  }
  if (Array.isArray(value)) return value.map(neutralizeInstructionText);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, neutralizeInstructionText(item)]),
    );
  }
  return value;
}

function isNegated(text: string, index: number): boolean {
  return /(?:\bnever|\bdo not|\bdon't|\bmust not|\bavoid)\s*$/.test(
    text.slice(Math.max(0, index - 24), index).toLowerCase(),
  );
}

function blockedCategory(text: string): WorkHandoverPreflight['blocked_category'] {
  const patterns: Array<{
    category: NonNullable<WorkHandoverPreflight['blocked_category']>;
    pattern: RegExp;
  }> = [
    {
      category: 'credential_sharing',
      pattern:
        /\b(?:share|send|provide|reveal|exfiltrate|copy|paste|publish)\b[^.!?\n]{0,60}\b(?:credential|password|private key|seed phrase|api key|access token|otp|one-time code)\b/gi,
    },
    {
      category: 'security_bypass',
      pattern:
        /\b(?:bypass|circumvent|disable|evade)\b[^.!?\n]{0,50}\b(?:security|approval|access control|mfa|2fa|authentication|audit|policy)\b/gi,
    },
    {
      category: 'unauthorized_access',
      pattern:
        /\b(?:access|enter|take over|impersonate|hack|exploit)\b[^.!?\n]{0,70}\b(?:without (?:authorization|permission|consent)|someone else's|another person's)\b/gi,
    },
    {
      category: 'destructive_concealment',
      pattern:
        /\b(?:delete|erase|wipe|destroy|disable|tamper with)\b[^.!?\n]{0,50}\b(?:audit logs?|evidence|security logs?|backups?)\b/gi,
    },
  ];
  for (const { category, pattern } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (!isNegated(text, match.index)) return category;
      if (match[0].length === 0) pattern.lastIndex++;
    }
  }
  return null;
}

function hasInjectionLikeText(text: string): boolean {
  return text.includes(UNTRUSTED_INSTRUCTION) ||
    /\b(?:ignore|override|disregard)\b[^.!?\n]{0,160}\b(?:previous|system|developer|safety|instructions?|prompt)\b|\b(?:system|developer)\s+prompt\b/i.test(
      text,
    );
}

/**
 * Recursively scans raw request data before schema parsing or generation.
 * It returns categories only, never a detected credential value.
 */
export function preflightWorkHandover(input: unknown): WorkHandoverPreflight {
  const categories = new Set<string>();
  const secretSanitized = sanitizeNested(input, categories);
  const text = collectStrings(secretSanitized).join('\n');
  const malicious = blockedCategory(text);
  const injectionDetected = hasInjectionLikeText(text);
  const sanitized = injectionDetected
    ? neutralizeInstructionText(secretSanitized)
    : secretSanitized;
  return {
    safe: categories.size === 0 && malicious === null,
    sanitized,
    sensitive_categories: [...categories].sort(),
    blocked_category: malicious,
    injection_like_text_detected: injectionDetected,
  };
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

type DomainReviewFlag = WorkHandoverOutput['data_quality']['domain_review_flags'][number];

function domainReviewFlags(input: WorkHandoverInput): DomainReviewFlag[] {
  const text = collectStrings(input).join('\n');
  const flags: DomainReviewFlag[] = [];
  if (/\b(?:legal advice|determine (?:whether .* is )?legal|interpret (?:the )?contract|liability determination)\b/i.test(text)) {
    flags.push('legal');
  }
  if (/\b(?:fire|dismiss|terminate)\b[^.!?\n]{0,30}\b(?:employee|worker|staff member)\b|\bdisciplinary determination\b/i.test(text)) {
    flags.push('hr');
  }
  if (/\b(?:diagnos(?:e|is)|prescribe|dosage decision|treatment decision|medical determination|administer|inject)\b[^.!?\n]{0,40}\b(?:medicine|medication|drug|insulin|dose|patient)\b/i.test(text)) {
    flags.push('medical');
  }
  if (/\b(?:aircraft control|flight control|hazardous machinery|lockout[ -]?tagout|high voltage|confined space|chemical handling|weapons? system|nuclear operations?)\b/i.test(text)) {
    flags.push('safety_critical');
  }
  if (/\b(?:wire|bank|funds?|crypto|token)\s+transfer\b|\b(?:execute|place|approve)\b[^.!?\n]{0,30}\b(?:trade|payment|transfer|withdrawal)\b/i.test(text)) {
    flags.push('financial_execution');
  }
  if (input.regulated_or_safety_critical) flags.push('regulated_or_safety_critical');
  return [...new Set(flags)];
}

function dependencyCycles(tasks: WorkHandoverInput['tasks']): string[][] {
  const taskIds = new Set(tasks.map((task) => task.id));
  const graph = new Map(
    tasks.map((task) => [task.id, task.dependency_ids.filter((id) => taskIds.has(id))]),
  );
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();

  const canonical = (cycle: string[]): { key: string; path: string[] } => {
    const body = cycle.slice(0, -1);
    let best = body;
    for (let index = 1; index < body.length; index++) {
      const rotated = [...body.slice(index), ...body.slice(0, index)];
      if (rotated.join('\u0000') < best.join('\u0000')) best = rotated;
    }
    return { key: best.join('->'), path: [...best, best[0]!] };
  };

  const visit = (id: string): void => {
    state.set(id, 1);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) {
      if ((state.get(dependency) ?? 0) === 0) visit(dependency);
      else if (state.get(dependency) === 1) {
        const start = stack.indexOf(dependency);
        const normalized = canonical([...stack.slice(start), dependency]);
        cycles.set(normalized.key, normalized.path);
      }
    }
    stack.pop();
    state.set(id, 2);
  };

  for (const task of tasks) if ((state.get(task.id) ?? 0) === 0) visit(task.id);
  return [...cycles.values()].sort((left, right) => left.join().localeCompare(right.join()));
}

function attentionSignals(
  task: WorkHandoverInput['tasks'][number],
  now: Date,
): string[] {
  const signals: string[] = [];
  if (task.status === 'blocked') signals.push('caller marked task blocked');
  if (task.status === 'in_progress') signals.push('caller marked task in progress');
  if (task.blocker_ids.length > 0) signals.push('caller linked one or more blockers');
  if (task.due_at && new Date(task.due_at).getTime() < now.getTime() && task.status !== 'done' && task.status !== 'cancelled') {
    signals.push('caller-provided deadline passed before generation time');
  }
  return signals;
}

const PRIORITY_SCORE = { critical: 400, high: 300, medium: 200, low: 100 } as const;
const STATUS_SCORE = {
  blocked: 50,
  in_progress: 40,
  not_started: 30,
  paused: 20,
  done: -100,
  cancelled: -110,
} as const;

function taskScore(task: WorkHandoverInput['tasks'][number], now: Date): number {
  let score = task.priority ? PRIORITY_SCORE[task.priority] : 0;
  if (task.status) score += STATUS_SCORE[task.status];
  if (task.blocker_ids.length > 0) score += 30;
  if (task.due_at && new Date(task.due_at).getTime() < now.getTime() && task.status !== 'done' && task.status !== 'cancelled') {
    score += 80;
  }
  return score;
}

function missingFields(task: WorkHandoverInput['tasks'][number]): WorkHandoverOutput['prioritized_items'][number]['unknown_fields'] {
  const fields: WorkHandoverOutput['prioritized_items'][number]['unknown_fields'] = [];
  if (!task.status) {
    if (!task.owner) fields.push('owner');
    fields.push('status');
    if (!task.next_action) fields.push('next_action');
    if (!task.definition_of_done) fields.push('definition_of_done');
    return fields;
  }
  if (task.status === 'done') {
    if (!task.completion_evidence) fields.push('completion_evidence');
    return fields;
  }
  if (task.status === 'cancelled') return fields;
  if (!task.owner) fields.push('owner');
  if (!task.next_action) fields.push('next_action');
  if (!task.definition_of_done) fields.push('definition_of_done');
  if (task.priority === 'critical' && !task.due_at) fields.push('due_at');
  if (task.priority === 'critical' && !task.escalation_trigger) fields.push('escalation_trigger');
  return fields;
}

interface RankedTask {
  task: WorkHandoverInput['tasks'][number];
  inputIndex: number;
  score: number;
}

function compareRankedTasks(left: RankedTask, right: RankedTask): number {
  if (right.score !== left.score) return right.score - left.score;
  const leftDue = left.task.due_at
    ? new Date(left.task.due_at).getTime()
    : Number.POSITIVE_INFINITY;
  const rightDue = right.task.due_at
    ? new Date(right.task.due_at).getTime()
    : Number.POSITIVE_INFINITY;
  return leftDue - rightDue || left.inputIndex - right.inputIndex;
}

/** Priority-aware topological ordering: an unfinished internal prerequisite is
 * always listed before its dependent, even when the dependent has a higher
 * caller priority. Cycles are retained at the end and reported separately. */
function orderTasks(
  tasks: WorkHandoverInput['tasks'],
  referenceTime: Date,
): RankedTask[] {
  const byId = new Map(tasks.map((task, inputIndex) => [
    task.id,
    { task, inputIndex, score: taskScore(task, referenceTime) },
  ]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    const activeInternalDependencies = task.dependency_ids.filter((id) => {
      const dependency = byId.get(id)?.task;
      return dependency && dependency.status !== 'done' && dependency.status !== 'cancelled';
    });
    indegree.set(task.id, activeInternalDependencies.length);
    for (const dependencyId of activeInternalDependencies) {
      dependents.set(dependencyId, [...(dependents.get(dependencyId) ?? []), task.id]);
    }
  }

  const ready = [...byId.values()]
    .filter(({ task }) => (indegree.get(task.id) ?? 0) === 0)
    .sort(compareRankedTasks);
  const ordered: RankedTask[] = [];
  const emitted = new Set<string>();
  while (ready.length > 0) {
    const next = ready.shift()!;
    if (emitted.has(next.task.id)) continue;
    emitted.add(next.task.id);
    ordered.push(next);
    for (const dependent of dependents.get(next.task.id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 1) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(byId.get(dependent)!);
        ready.sort(compareRankedTasks);
      }
    }
  }
  ordered.push(
    ...[...byId.values()]
      .filter(({ task }) => !emitted.has(task.id))
      .sort(compareRankedTasks),
  );
  return ordered;
}

function executionState(
  task: WorkHandoverInput['tasks'][number],
  taskById: Map<string, WorkHandoverInput['tasks'][number]>,
  dependencyById: Map<string, WorkHandoverInput['dependencies'][number]>,
  knownDependencyIds: Set<string>,
): WorkHandoverOutput['prioritized_items'][number]['execution_state'] {
  if (task.status === 'done') return 'complete';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.status === 'blocked' || task.blocker_ids.length > 0) return 'blocked';
  if (
    task.dependency_ids.some((id) => {
      if (!knownDependencyIds.has(id)) return true;
      const internal = taskById.get(id);
      if (internal) return internal.status !== 'done' && internal.status !== 'cancelled';
      const external = dependencyById.get(id);
      return external?.status !== 'complete' && external?.status !== 'available';
    })
  ) {
    return 'waiting_for_dependency';
  }
  if (!task.status) return 'unknown';
  return 'executable';
}

export function buildWorkHandover(
  rawInput: WorkHandoverInput,
  now: Date = new Date(),
): WorkHandoverOutput {
  const preflight = preflightWorkHandover(rawInput);
  if (preflight.blocked_category) {
    throw new Error(`request_blocked:${preflight.blocked_category}`);
  }
  const input = WorkHandoverInputSchema.parse(preflight.sanitized);
  const referenceTime = input.as_of ? new Date(input.as_of) : now;
  const taskIds = new Set(input.tasks.map((task) => task.id));
  const dependencyIds = new Set(input.dependencies.map((item) => item.id));
  const blockerIds = new Set(input.blockers.map((item) => item.id));
  const knownDependencyIds = new Set([...taskIds, ...dependencyIds]);
  const missingDependencyRefs = input.tasks.flatMap((task) =>
    task.dependency_ids
      .filter((id) => !knownDependencyIds.has(id))
      .map((id) => ({ task_id: task.id, dependency_id: id })),
  );
  const missingBlockerRefs = input.tasks.flatMap((task) =>
    task.blocker_ids
      .filter((id) => !blockerIds.has(id))
      .map((id) => ({ task_id: task.id, blocker_id: id })),
  );
  const cycles = dependencyCycles(input.tasks);
  const externalDependencyById = new Map(input.dependencies.map((item) => [item.id, item]));
  const taskById = new Map(input.tasks.map((item) => [item.id, item]));
  const contradictions: string[] = [];
  const unknowns: string[] = [];

  for (const task of input.tasks) {
    if (task.status === 'done' && task.blocker_ids.length > 0) {
      contradictions.push(`Task ${task.id} is marked done but still references blockers.`);
    }
    if (task.status === 'blocked' && task.blocker_ids.length === 0 && task.dependency_ids.length === 0) {
      contradictions.push(`Task ${task.id} is marked blocked without a blocker or dependency reference.`);
    }
    if (task.status === 'done' && task.next_action) {
      contradictions.push(`Task ${task.id} is marked done but also has a next action.`);
    }
    if (task.status === 'done' && !task.completion_evidence) {
      unknowns.push(`Completion of task ${task.id} is caller-asserted but has no completion evidence.`);
    }
    if (task.status === 'done') {
      for (const dependencyId of task.dependency_ids) {
        const external = externalDependencyById.get(dependencyId);
        const internal = taskById.get(dependencyId);
        if ((external && external.status !== 'complete') || (internal && internal.status !== 'done')) {
          contradictions.push(`Task ${task.id} is marked done while dependency ${dependencyId} is not marked complete.`);
        }
      }
    }
    for (const field of missingFields(task)) {
      unknowns.push(`Task ${task.id} has no caller-provided ${field.replaceAll('_', ' ')}.`);
    }
  }
  for (const ref of missingDependencyRefs) {
    unknowns.push(`Task ${ref.task_id} references unknown dependency ${ref.dependency_id}.`);
  }
  for (const ref of missingBlockerRefs) {
    unknowns.push(`Task ${ref.task_id} references unknown blocker ${ref.blocker_id}.`);
  }

  const reviewFlags = domainReviewFlags(input);
  if (input.regulated_or_safety_critical && !input.approved_sop_reference) {
    unknowns.push('No approved SOP reference was supplied for safety-critical or regulated work.');
  }
  if (input.regulated_or_safety_critical && !input.authorized_supervisor) {
    unknowns.push('No authorized supervisor was supplied for safety-critical or regulated work.');
  }
  if (!input.timezone && input.tasks.some((task) => task.due_at)) {
    unknowns.push('No display timezone was supplied; deadlines remain in their caller-provided offsets.');
  }

  const ordered = orderTasks(input.tasks, referenceTime);
  const authorizedReviewRequired = reviewFlags.length > 0;
  const suppressProceduralDetails = authorizedReviewRequired;
  const prioritizedItems: WorkHandoverOutput['prioritized_items'] = ordered.map(
    ({ task }, index) => {
      const signals = attentionSignals(task, referenceTime);
      const dueState = !task.due_at
        ? 'not_provided'
        : task.status === 'done' || task.status === 'cancelled'
          ? 'not_applicable'
        : new Date(task.due_at).getTime() < referenceTime.getTime()
          ? 'overdue'
          : 'upcoming';
      return {
        rank: index + 1,
        task_id: task.id,
        title: suppressProceduralDetails ? `Restricted task ${task.id}` : task.title,
        description: suppressProceduralDetails ? null : nullable(task.description),
        caller_priority: nullable(task.priority),
        priority_source: task.priority && signals.length
          ? 'caller_priority_with_attention_signals'
          : task.priority
            ? 'caller_priority'
          : signals.length
            ? 'derived_attention_signals'
            : 'input_order',
        attention_signals: signals,
        owner: nullable(task.owner),
        ownership_state: task.owner ? 'assigned' : 'unassigned',
        status: nullable(task.status),
        status_source: task.status ? 'caller_reported' : 'missing',
        completion_verification: task.status !== 'done'
          ? 'not_applicable'
          : task.completion_evidence
            ? 'evidence_provided_unverified'
            : 'reported_done_unverified',
        execution_state: executionState(task, taskById, externalDependencyById, knownDependencyIds),
        next_action: task.next_action && !suppressProceduralDetails
          ? { source: 'caller_provided', value: task.next_action }
          : { source: 'missing', value: null },
        due_at: nullable(task.due_at),
        deadline_state: dueState,
        dependency_ids: task.dependency_ids,
        blocker_ids: task.blocker_ids,
        missing_dependency_ids: task.dependency_ids.filter((id) => !knownDependencyIds.has(id)),
        missing_blocker_ids: task.blocker_ids.filter((id) => !blockerIds.has(id)),
        definition_of_done: suppressProceduralDetails ? null : nullable(task.definition_of_done),
        completion_evidence: suppressProceduralDetails ? null : nullable(task.completion_evidence),
        escalation_trigger: suppressProceduralDetails ? null : nullable(task.escalation_trigger),
        unknown_fields: missingFields(task),
        authorized_review_required: authorizedReviewRequired,
      };
    },
  );

  const questions: string[] = [];
  const idsMissing = (
    field: WorkHandoverOutput['prioritized_items'][number]['unknown_fields'][number],
  ) => prioritizedItems.filter((item) => item.unknown_fields.includes(field)).map((item) => item.task_id);
  const addGapQuestion = (
    field: WorkHandoverOutput['prioritized_items'][number]['unknown_fields'][number],
    question: (ids: string) => string,
  ) => {
    const ids = idsMissing(field);
    if (ids.length) questions.push(question(ids.join(', ')));
  };
  if (authorizedReviewRequired) {
    questions.push('Which authorized person must review and approve this handover before anyone acts?');
  }
  if (input.regulated_or_safety_critical && !input.approved_sop_reference) {
    questions.push('Which approved SOP governs this handover?');
  }
  if (input.regulated_or_safety_critical && !input.authorized_supervisor) {
    questions.push('Which authorized supervisor must review this handover?');
  }
  addGapQuestion('owner', (ids) => `Who owns these tasks: ${ids}?`);
  addGapQuestion('status', (ids) => `What are the current caller-verified statuses of these tasks: ${ids}?`);
  addGapQuestion('next_action', (ids) => `What owner-approved next actions apply to these tasks: ${ids}?`);
  addGapQuestion('definition_of_done', (ids) => `What definitions of done apply to these tasks: ${ids}?`);
  addGapQuestion('completion_evidence', (ids) => `What evidence supports reported completion of these tasks: ${ids}?`);
  if (missingDependencyRefs.length) {
    questions.push(`What are the missing dependency records: ${missingDependencyRefs.map((ref) => `${ref.task_id}->${ref.dependency_id}`).join(', ')}?`);
  }
  if (missingBlockerRefs.length) {
    questions.push(`What are the missing blocker records: ${missingBlockerRefs.map((ref) => `${ref.task_id}->${ref.blocker_id}`).join(', ')}?`);
  }
  if (cycles.length) {
    questions.push(`Which dependency links should be corrected in these cycles: ${cycles.map((cycle) => cycle.join(' -> ')).join('; ')}?`);
  }
  if (!input.timezone && input.tasks.some((task) => task.due_at)) {
    questions.push('Which IANA timezone should readers use when viewing deadlines?');
  }

  const handoverChecklist: WorkHandoverOutput['handover_checklist'] = [];
  const addChecklist = (taskId: string | null, action: string, evidence: string) => {
    if (handoverChecklist.length >= 8) return;
    handoverChecklist.push({
      step: handoverChecklist.length + 1,
      task_id: taskId,
      action,
      evidence_required: evidence,
      source: 'keepflow_process_suggestion',
    });
  };
  if (authorizedReviewRequired) {
    addChecklist(
      null,
      'Pause operational execution and route the source handover to an authorized reviewer.',
      'Reviewer identity and review decision recorded outside KeepFlow.',
    );
    addChecklist(
      null,
      'Confirm the governing approved SOP before releasing procedural details.',
      'Caller-provided SOP reference checked by the authorized reviewer.',
    );
  } else {
    for (const item of prioritizedItems) {
      if (item.completion_verification === 'reported_done_unverified') {
        addChecklist(item.task_id, `Verify the caller-reported completion of task ${item.task_id}.`, 'Completion evidence accepted by the recorded owner.');
      } else if (item.execution_state === 'waiting_for_dependency') {
        addChecklist(item.task_id, `Verify dependencies for task ${item.task_id} before treating it as executable.`, 'Dependency owners and statuses recorded.');
      } else if (item.execution_state === 'blocked') {
        addChecklist(item.task_id, `Confirm blocker ownership and escalation conditions for task ${item.task_id}.`, 'Blocker status, owner, and escalation trigger recorded.');
      }
      if (item.unknown_fields.includes('owner')) {
        addChecklist(item.task_id, `Confirm an accountable owner for task ${item.task_id}.`, 'Owner acknowledgement recorded.');
      }
      if (item.unknown_fields.includes('status')) {
        addChecklist(item.task_id, `Verify the current status of task ${item.task_id}.`, 'Timestamped status supplied by the owner.');
      }
      if (item.unknown_fields.includes('next_action')) {
        addChecklist(item.task_id, `Obtain an owner-approved next action for task ${item.task_id}.`, 'Next action and owner acknowledgement recorded.');
      }
      if (item.unknown_fields.includes('definition_of_done')) {
        addChecklist(item.task_id, `Define completion evidence for task ${item.task_id}.`, 'Testable definition of done recorded.');
      }
      if (item.deadline_state === 'overdue') {
        addChecklist(item.task_id, `Confirm escalation or a revised deadline for overdue task ${item.task_id}.`, 'Owner-approved escalation or revised offset-aware deadline recorded.');
      }
    }
  }
  if (handoverChecklist.length === 0) {
    addChecklist(
      null,
      'Review the ordered handover with every recorded owner before transfer.',
      'Owner acknowledgements recorded for all unresolved tasks.',
    );
  }

  const incomplete =
    unknowns.length > 0 ||
    contradictions.length > 0 ||
    missingDependencyRefs.length > 0 ||
    missingBlockerRefs.length > 0 ||
    cycles.length > 0;
  const assessment: WorkHandoverOutput['assessment'] = authorizedReviewRequired
    ? 'needs_authorized_review'
    : incomplete
      ? 'needs_information'
      : 'ready';
  const unresolvedTasks = input.tasks.filter(
    (task) => task.status !== 'done' && task.status !== 'cancelled',
  );
  const overdueTasks = input.tasks.filter(
    (task) =>
      task.due_at &&
      new Date(task.due_at).getTime() < referenceTime.getTime() &&
      task.status !== 'done' &&
      task.status !== 'cancelled',
  );

  return WorkHandoverOutputSchema.parse({
    service: 'KeepFlow Work - Operational Handover',
    assessment,
    handover_title: suppressProceduralDetails ? 'Restricted operational handover' : input.handover_title,
    objective: suppressProceduralDetails
      ? 'Procedural details withheld pending authorized review.'
      : input.objective,
    as_of: nullable(input.as_of),
    deadline_reference: input.as_of ? 'caller_provided_as_of' : 'generation_time',
    timezone: nullable(input.timezone),
    current_state: suppressProceduralDetails ? null : nullable(input.current_state),
    rule_set_id: RULE_SET_ID,
    rule_set_version: RULE_SET_VERSION,
    summary: {
      total_tasks: input.tasks.length,
      unresolved_tasks: unresolvedTasks.length,
      blocked_tasks: input.tasks.filter((task) => task.status === 'blocked').length,
      unassigned_tasks: input.tasks.filter((task) => !task.owner).length,
      overdue_tasks: overdueTasks.length,
      source_based_overview: `${input.tasks.length} caller-provided task${input.tasks.length === 1 ? '' : 's'} ordered from explicit priority, attention signals, deadline, and input order; no task facts were invented.`,
    },
    prioritized_items: prioritizedItems,
    handover_checklist: handoverChecklist,
    responsibility_map: input.responsibilities.map((item) => ({
      id: item.id,
      area: suppressProceduralDetails ? `Restricted responsibility ${item.id}` : item.area,
      owner: nullable(item.owner),
      backup_owner: nullable(item.backup_owner),
      status: nullable(item.status),
      notes: suppressProceduralDetails ? null : nullable(item.notes),
    })),
    blocker_register: input.blockers.map((item) => ({
      id: item.id,
      description: suppressProceduralDetails ? `Restricted blocker ${item.id}` : item.description,
      owner: nullable(item.owner),
      status: nullable(item.status),
      next_action: suppressProceduralDetails ? null : nullable(item.next_action),
      escalation_trigger: suppressProceduralDetails ? null : nullable(item.escalation_trigger),
    })),
    dependency_register: input.dependencies.map((item) => ({
      id: item.id,
      description: suppressProceduralDetails ? `Restricted dependency ${item.id}` : item.description,
      owner: nullable(item.owner),
      status: nullable(item.status),
      due_at: nullable(item.due_at),
      escalation_trigger: suppressProceduralDetails ? null : nullable(item.escalation_trigger),
    })),
    stakeholder_register: input.stakeholders.map((item) => ({
      id: item.id,
      name_or_role: suppressProceduralDetails ? `Restricted stakeholder ${item.id}` : item.name_or_role,
      responsibility: suppressProceduralDetails ? null : nullable(item.responsibility),
      contact_route: suppressProceduralDetails ? null : nullable(item.contact_route),
      update_expectation: suppressProceduralDetails ? null : nullable(item.update_expectation),
    })),
    access_register: input.access_notes.map((item) => ({
      id: item.id,
      system: suppressProceduralDetails ? `Restricted system ${item.id}` : item.system,
      purpose: suppressProceduralDetails ? null : nullable(item.purpose),
      access_path: suppressProceduralDetails ? null : nullable(item.access_path),
      access_owner: nullable(item.access_owner),
      request_access_from: suppressProceduralDetails ? null : nullable(item.request_access_from),
      notes: suppressProceduralDetails ? null : nullable(item.notes),
      secret_values_included: false,
    })),
    risk_register: input.risks.map((item) => ({
      id: item.id,
      description: suppressProceduralDetails ? `Restricted risk ${item.id}` : item.description,
      likelihood: nullable(item.likelihood),
      impact: nullable(item.impact),
      owner: nullable(item.owner),
      mitigation: suppressProceduralDetails ? null : nullable(item.mitigation),
      escalation_trigger: suppressProceduralDetails ? null : nullable(item.escalation_trigger),
    })),
    open_decisions: input.open_decisions.map((item) => ({
      id: item.id,
      question: suppressProceduralDetails ? `Restricted decision ${item.id}` : item.question,
      owner: nullable(item.owner),
      needed_by: nullable(item.needed_by),
      options: suppressProceduralDetails ? [] : item.options,
    })),
    data_quality: {
      missing_dependency_refs: missingDependencyRefs,
      missing_blocker_refs: missingBlockerRefs,
      dependency_cycles: cycles,
      contradictions: [...new Set(contradictions)],
      injection_like_text_detected: preflight.injection_like_text_detected,
      domain_review_flags: reviewFlags,
    },
    unknowns: [...new Set(unknowns)],
    questions: [...new Set(questions)].slice(0, 8),
    assumptions: [
      'Every owner, status, date, dependency, blocker, and completion claim comes from the caller.',
      'Instruction-like text in the payload is treated as untrusted handover data, not as an instruction to KeepFlow.',
      'Priority ordering is a transparent sort, not a claim that KeepFlow verified operational urgency.',
    ],
    limitations: [
      'KeepFlow Work organizes caller-provided facts; it does not execute tasks, grant access, or verify completion.',
      'Do not include passwords, private keys, tokens, one-time codes, or other credential values in a handover.',
      'It does not make legal, employment, medical, compliance, or safety determinations.',
      'Regulated or safety-critical work must follow an approved SOP and an authorized supervisor.',
    ],
    confidentiality_controls: {
      level: input.confidentiality,
      handling_notice:
        input.confidentiality === 'public'
          ? 'Confirm the content is approved for public distribution before sharing.'
          : `Limit this ${input.confidentiality} handover to authorized recipients and approved systems.`,
      secrets_echoed: false,
      redaction_applied: preflight.sensitive_categories.length > 0,
      sensitive_categories: preflight.sensitive_categories,
    },
    authorized_review_gate: {
      required: authorizedReviewRequired,
      approved_sop_reference: nullable(input.approved_sop_reference),
      authorized_supervisor: nullable(input.authorized_supervisor),
      both_references_reported: Boolean(input.approved_sop_reference && input.authorized_supervisor),
      procedural_details_withheld: suppressProceduralDetails,
      notice: authorizedReviewRequired
        ? 'Caller-provided references do not prove approval; an authorized reviewer must validate the source handover before action.'
        : 'No regulated, safety-critical, legal, HR, medical, or financial-execution review trigger was detected.',
    },
    meta: {
      asp: 'KeepFlow',
      schema_version: '1.0.0',
      generated_at: now.toISOString(),
      stateless: true,
      stores_payload: false,
    },
  });
}

export function validateWorkHandover(
  output: unknown,
  sourceInput?: WorkHandoverInput,
): { valid: boolean; errors: string[] } {
  const parsed = WorkHandoverOutputSchema.safeParse(output);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }

  const errors: string[] = [];
  const scan = preflightWorkHandover(parsed.data);
  if (scan.sensitive_categories.length > 0) {
    errors.push(`secret-shaped output detected: ${scan.sensitive_categories.join(', ')}`);
  }
  if (scan.blocked_category) errors.push(`blocked instruction in output: ${scan.blocked_category}`);
  if (parsed.data.confidentiality_controls.secrets_echoed) {
    errors.push('output must declare that no secret values were echoed');
  }
  if (sourceInput) {
    try {
      const expected = buildWorkHandover(sourceInput, new Date(parsed.data.meta.generated_at));
      if (JSON.stringify(expected) !== JSON.stringify(parsed.data)) {
        errors.push('output does not exactly match the deterministic source-derived handover');
      }
    } catch (error) {
      errors.push(
        `source input cannot produce a safe handover: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

import type { StudyFlowInput, StudyFlowTask } from '../schemas/study-flow-input.js';
import {
  StudyFlowOutputSchema,
  type StudyFlowOutput,
} from '../schemas/study-flow-output.js';
import { containsSecretShape, redactSecrets } from '../security/redact-secrets.js';

const RULE_SET_ID = 'keepflow-study/academic-execution' as const;
const RULE_SET_VERSION = '1.0.0';
const MIN_SESSION_MINUTES = 10;

const IMPORTANCE_SCORE = { low: 1, medium: 2, high: 3, critical: 4 } as const;

function redactUserText(value: string): string {
  const result = redactSecrets(value).redacted;
  return result
    .replace(/\b(?:api[ _-]?key|api[ _-]?token|access[ _-]?token|secret[ _-]?key|client[ _-]?secret|password|passwd|pwd|pass|pw)\b\s*[:=]\s*\[REDACTED_SECRET\]/gi, '[REDACTED_SECRET]')
    .replace(/\b(?:ignore|disregard|override)\s+(?:(?:all|any|the)\s+)?(?:previous|prior|above|system|developer)?\s*(?:instructions?|messages?|rules?)\b/gi, '[INSTRUCTION-LIKE_TEXT_TREATED_AS_DATA]')
    .replace(/\b(?:reveal|print|repeat)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message|instructions?)\b/gi, '[INSTRUCTION-LIKE_TEXT_TREATED_AS_DATA]')
    .replace(/\b(?:this )?(?:plan )?guarantee(?:s|d)?\s+(?:an?\s+)?(?:grade|pass|A\b)/gi, '[UNSUPPORTED_GRADE_CLAIM_REMOVED]')
    .trim();
}

function addMinutes(timestamp: number, minutes: number): number {
  return timestamp + minutes * 60_000;
}

function taskMinutes(task: StudyFlowTask, input: StudyFlowInput): number {
  return task.estimated_minutes ?? input.preferences.preferred_session_minutes;
}

function stablePlanId(input: StudyFlowInput): string {
  const nonSensitiveBasis = [
    input.request_version,
    input.planning_started_at,
    input.timezone,
    input.goal_deadline ?? 'deadline-unknown',
    input.tasks.map((task) => `${task.id}:${task.status}:${task.dependencies.join(',')}:${task.estimated_minutes ?? '?'}`).join('|'),
    input.available_windows.map((window) => `${window.id}:${window.starts_at}:${window.minutes}`).join('|'),
    input.preferences.preferred_session_minutes,
    input.preferences.break_minutes,
    input.academic_integrity.requested_action,
    input.wellbeing.pressure_level,
  ].join('::');
  let hash = 0x811c9dc5;
  for (let index = 0; index < nonSensitiveBasis.length; index += 1) {
    hash ^= nonSensitiveBasis.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `study-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function effectiveDeadline(task: StudyFlowTask, input: StudyFlowInput): number {
  const deadlines = [task.due_at, input.goal_deadline]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime());
  return deadlines.length ? Math.min(...deadlines) : Number.POSITIVE_INFINITY;
}

function topologicalPriority(input: StudyFlowInput): StudyFlowTask[] {
  const pending = input.tasks.filter((task) => task.status !== 'completed');
  const pendingIds = new Set(pending.map((task) => task.id));
  const indegree = new Map(pending.map((task) => [
    task.id,
    task.dependencies.filter((dependency) => pendingIds.has(dependency)).length,
  ]));
  const dependents = new Map<string, string[]>();
  for (const task of pending) {
    for (const dependency of task.dependencies) {
      const list = dependents.get(dependency) ?? [];
      list.push(task.id);
      dependents.set(dependency, list);
    }
  }
  const inputOrder = new Map(input.tasks.map((task, index) => [task.id, index]));
  const compare = (a: StudyFlowTask, b: StudyFlowTask): number => {
    const deadlineDifference = effectiveDeadline(a, input) - effectiveDeadline(b, input);
    if (Number.isFinite(deadlineDifference) && deadlineDifference !== 0) return deadlineDifference;
    const importanceDifference = IMPORTANCE_SCORE[b.importance] - IMPORTANCE_SCORE[a.importance];
    if (importanceDifference) return importanceDifference;
    if (a.status !== b.status) {
      if (a.status === 'in_progress') return -1;
      if (b.status === 'in_progress') return 1;
    }
    const unlockDifference = (dependents.get(b.id)?.length ?? 0) - (dependents.get(a.id)?.length ?? 0);
    if (unlockDifference) return unlockDifference;
    return (inputOrder.get(a.id) ?? 0) - (inputOrder.get(b.id) ?? 0);
  };

  const ready = pending.filter((task) => indegree.get(task.id) === 0).sort(compare);
  const ordered: StudyFlowTask[] = [];
  while (ready.length) {
    const next = ready.shift()!;
    ordered.push(next);
    for (const dependentId of dependents.get(next.id) ?? []) {
      const nextDegree = (indegree.get(dependentId) ?? 1) - 1;
      indegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        const dependent = pending.find((task) => task.id === dependentId);
        if (dependent) {
          ready.push(dependent);
          ready.sort(compare);
        }
      }
    }
  }
  return ordered;
}

function integrityRedirectRequired(input: StudyFlowInput): boolean {
  const requested = input.academic_integrity.requested_action;
  if (['produce_submission', 'take_live_assessment', 'impersonate_learner'].includes(requested)) {
    return true;
  }
  if (input.academic_integrity.assessment_context === 'live_or_proctored_assessment' &&
    requested !== 'plan_study') return true;
  const declaredText = [
    input.goal,
    ...input.tasks.flatMap((task) => [task.title, task.definition_of_done ?? '', task.evidence_of_done ?? '']),
    ...input.blockers.map((blocker) => blocker.detail),
  ].join(' ').toLowerCase();
  return [
    /\b(?:take|sit|answer|complete)\s+(?:my|the|this)\s+(?:live\s+|proctored\s+)?(?:exam|test|quiz|assessment)\s+(?:for|as)\s+me\b/,
    /\b(?:write|complete|produce|do)\s+(?:my|the)\s+(?:graded\s+)?(?:essay|assignment|submission|coursework)\s+(?:for\s+me|as\s+my\s+own)\b/,
    /\b(?:do\s+my\s+homework(?:\s+for\s+me)?|give\s+me\s+(?:all\s+)?(?:the\s+)?answers?|answer\s+(?:all\s+)?(?:the\s+)?questions?\s+for\s+me)\b/,
    /\b(?:solve|write|complete)\s+(?:my\s+|the\s+)?graded\s+(?:assignment|coursework|assessment|exam)\b/,
    /\b(?:impersonate\s+me|log\s+in\s+as\s+me|submit\s+as\s+me|ghostwrite|help\s+me\s+cheat)\b/,
  ].some((pattern) => pattern.test(declaredText));
}

function wellbeingPauseRequired(input: StudyFlowInput): boolean {
  if (input.wellbeing.immediate_safety_concern || input.wellbeing.pressure_level === 'crisis') {
    return true;
  }
  const declaredText = [
    input.goal,
    ...input.tasks.flatMap((task) => [task.title, task.definition_of_done ?? '', task.evidence_of_done ?? '']),
    ...input.blockers.map((blocker) => blocker.detail),
  ].join(' ').toLowerCase();
  return [
    /\bi\s+(?:will|want\s+to|might|plan\s+to|am\s+going\s+to)\s+(?:kill|hurt)\s+myself\b/,
    /\b(?:i(?:'m|\s+am)\s+suicidal|i\s+want\s+to\s+(?:end|take)\s+my\s+life)\b/,
    /\b(?:suicidal|self[- ]harm)\s+thoughts?\b/,
  ].some((pattern) => pattern.test(declaredText));
}

function maxSessionMinutes(input: StudyFlowInput): number {
  let maximum = input.preferences.preferred_session_minutes;
  if (input.wellbeing.pressure_level === 'high') maximum = Math.min(maximum, 30);
  if (input.wellbeing.pressure_level === 'overwhelming') maximum = Math.min(maximum, 20);
  if (input.wellbeing.fatigue_level === 'tired') maximum = Math.min(maximum, 30);
  if (input.wellbeing.fatigue_level === 'severely_sleep_deprived') maximum = Math.min(maximum, 20);
  return Math.max(MIN_SESSION_MINUTES, maximum);
}

function loadFraction(input: StudyFlowInput): number {
  if (input.wellbeing.fatigue_level === 'severely_sleep_deprived') return 0.5;
  if (input.wellbeing.pressure_level === 'overwhelming') return 0.6;
  if (input.wellbeing.pressure_level === 'high' || input.wellbeing.fatigue_level === 'tired') return 0.8;
  return 1;
}

interface WorkingWindow {
  id: string;
  start: number;
  cursor: number;
  end: number;
}

function workingWindows(input: StudyFlowInput): { windows: WorkingWindow[]; availableMinutes: number } {
  const planningStart = new Date(input.planning_started_at).getTime();
  const globalDeadline = input.goal_deadline
    ? new Date(input.goal_deadline).getTime()
    : Number.POSITIVE_INFINITY;
  const windows = input.available_windows
    .map((window) => {
      const start = new Date(window.starts_at).getTime();
      const end = Math.min(addMinutes(start, window.minutes), globalDeadline);
      return { id: window.id, start, cursor: Math.max(start, planningStart), end };
    })
    .filter((window) => window.end - window.cursor >= MIN_SESSION_MINUTES * 60_000)
    .sort((a, b) => a.cursor - b.cursor);
  const availableMinutes = windows.reduce(
    (total, window) => total + Math.floor((window.end - window.cursor) / 60_000),
    0,
  );
  return { windows, availableMinutes };
}

function buildUnresolved(input: StudyFlowInput, availableMinutes: number): StudyFlowOutput['unresolved_details'] {
  const unresolved: StudyFlowOutput['unresolved_details'] = [];
  const outstanding = input.tasks.filter((task) => task.status !== 'completed');
  const planningStart = new Date(input.planning_started_at).getTime();
  if (input.goal_deadline && new Date(input.goal_deadline).getTime() <= planningStart) {
    unresolved.push({
      field: 'goal_deadline',
      why_it_matters: 'The declared goal deadline is not later than planning_started_at, so it cannot be presented as achievable.',
      question: 'Is there a corrected future deadline, or should the plan focus on communicating the missed deadline?',
    });
  }
  if (!input.goal_deadline && outstanding.every((task) => !task.due_at)) {
    unresolved.push({
      field: 'goal_deadline',
      why_it_matters: 'Feasibility cannot be confirmed without at least one real deadline.',
      question: 'What is the deadline, including local time and UTC offset?',
    });
  }
  for (const task of outstanding) {
    if (task.due_at && new Date(task.due_at).getTime() <= planningStart) {
      unresolved.push({
        field: `tasks.${task.id}.due_at`,
        why_it_matters: 'This task deadline has already passed, so no future session can meet it.',
        question: `Should task ${task.id} be re-scoped or discussed with the relevant instructor?`,
      });
    }
    if (task.estimated_minutes === undefined) {
      unresolved.push({
        field: `tasks.${task.id}.estimated_minutes`,
        why_it_matters: 'A default session length was used, so capacity may be under- or over-estimated.',
        question: `How many focused minutes are realistically needed for task ${task.id}?`,
      });
    }
    if (!task.definition_of_done || !task.evidence_of_done) {
      unresolved.push({
        field: `tasks.${task.id}.completion_evidence`,
        why_it_matters: 'The service cannot infer an instructor rubric or submission requirement.',
        question: `What exact result and evidence will prove task ${task.id} is complete?`,
      });
    }
    if (task.status === 'blocked') {
      unresolved.push({
        field: `tasks.${task.id}.status`,
        why_it_matters: 'Blocked work is not scheduled until its blocker is resolved.',
        question: `What must happen before task ${task.id} can start?`,
      });
    }
  }
  if (availableMinutes === 0) {
    unresolved.push({
      field: 'available_windows',
      why_it_matters: 'No supplied window has at least ten usable minutes before the declared deadline.',
      question: 'Which future availability window can be used before the deadline?',
    });
  }
  if (input.academic_integrity.collaboration_policy === 'unknown') {
    unresolved.push({
      field: 'academic_integrity.collaboration_policy',
      why_it_matters: 'Permitted collaboration and resource use cannot be assumed.',
      question: 'What collaboration and resource rules apply to this work?',
    });
  }
  if (input.preferences.access_needs.length) {
    unresolved.push({
      field: 'preferences.access_needs',
      why_it_matters: 'Access needs were preserved as constraints, but the service cannot safely infer a specific accommodation or change availability.',
      question: 'Which task, session, material, or timing adaptation should be applied to the declared access needs?',
    });
  }
  return unresolved.slice(0, 20);
}

function priorityQueue(input: StudyFlowInput, ordered: StudyFlowTask[]): StudyFlowOutput['priority_queue'] {
  const pendingIds = new Set(ordered.map((task) => task.id));
  const blockerIds = new Set(input.blockers.flatMap((blocker) => blocker.task_id ? [blocker.task_id] : []));
  return ordered.map((task, index) => {
    const dependencyStatus = task.status === 'blocked' || blockerIds.has(task.id)
      ? 'reported_blocker' as const
      : task.dependencies.some((dependency) => pendingIds.has(dependency))
        ? 'waiting_for_dependency' as const
        : 'ready' as const;
    const due = task.due_at ?? input.goal_deadline ?? null;
    return {
      rank: index + 1,
      task_id: task.id,
      subject: redactUserText(task.subject),
      title: redactUserText(task.title),
      importance: task.importance,
      due_at: due,
      remaining_minutes: taskMinutes(task, input),
      dependency_status: dependencyStatus,
      rationale: dependencyStatus === 'reported_blocker'
        ? 'Kept visible but not scheduled until the reported blocker is resolved.'
        : task.dependencies.length
          ? `Placed after ${task.dependencies.join(', ')} so prerequisite work comes first.`
          : `Ordered by declared deadline, ${task.importance} importance, current status, and downstream dependencies.`,
    };
  });
}

function scheduleSessions(
  input: StudyFlowInput,
  ordered: StudyFlowTask[],
  windows: WorkingWindow[],
  availableMinutes: number,
): StudyFlowOutput['sessions'] {
  const sessions: StudyFlowOutput['sessions'] = [];
  const completed = new Set(input.tasks.filter((task) => task.status === 'completed').map((task) => task.id));
  const blockerIds = new Set(input.blockers.flatMap((blocker) => blocker.task_id ? [blocker.task_id] : []));
  const maximum = maxSessionMinutes(input);
  const workLimit = Math.floor(availableMinutes * loadFraction(input));
  let scheduledMinutes = 0;

  for (const task of ordered) {
    if (task.status === 'blocked' || blockerIds.has(task.id)) continue;
    if (task.dependencies.some((dependency) => !completed.has(dependency))) continue;
    let remaining = taskMinutes(task, input);
    const deadline = effectiveDeadline(task, input);
    for (const window of windows) {
      while (remaining >= MIN_SESSION_MINUTES && scheduledMinutes < workLimit) {
        const usableEnd = Math.min(window.end, deadline);
        const available = Math.floor((usableEnd - window.cursor) / 60_000);
        const remainingLoad = workLimit - scheduledMinutes;
        let duration = Math.min(remaining, maximum, available, remainingLoad);
        const remainder = remaining - duration;
        if (remainder > 0 && remainder < MIN_SESSION_MINUTES) {
          const adjusted = duration - (MIN_SESSION_MINUTES - remainder);
          if (adjusted >= MIN_SESSION_MINUTES) duration = adjusted;
        }
        if (duration < MIN_SESSION_MINUTES) break;

        const isFinalTaskSession = duration === remaining;
        const sessionNumber = sessions.length + 1;
        const title = redactUserText(task.title);
        const subject = redactUserText(task.subject);
        const materials = task.materials.map(redactUserText);
        sessions.push({
          session_id: `study-${String(sessionNumber).padStart(3, '0')}`,
          order: sessionNumber,
          window_id: window.id,
          task_id: task.id,
          subject,
          title,
          starts_at: new Date(window.cursor).toISOString(),
          duration_minutes: duration,
          objective: `${isFinalTaskSession ? 'Finish' : 'Advance'} the declared task "${title}" for ${subject}.`,
          actions: [
            materials.length
              ? 'Open only the caller-declared materials listed for this session.'
              : 'Open the original task instructions; no source or rubric has been invented.',
            `Work on the declared ${task.kind.replace(/_/g, ' ')} task for ${duration} focused minutes.`,
            'Stop at the session boundary and record completed work, remaining work, and the next concrete action.',
          ],
          definition_of_done: task.definition_of_done
            ? redactUserText(task.definition_of_done)
            : isFinalTaskSession
              ? 'Check the result against the original task requirements before marking it complete.'
              : 'Complete this time-box and record the exact next action; task completion is not assumed.',
          evidence_of_done: task.evidence_of_done
            ? redactUserText(task.evidence_of_done)
            : 'Record what changed during the session and compare it with the original requirements.',
          source_materials: materials,
        });
        remaining -= duration;
        scheduledMinutes += duration;
        window.cursor = addMinutes(window.cursor, duration);
        const breakEnd = addMinutes(window.cursor, input.preferences.break_minutes);
        if (breakEnd <= window.end) window.cursor = breakEnd;
      }
      if (remaining === 0) break;
    }
    if (remaining === 0) completed.add(task.id);
  }
  return sessions;
}

function dateKeyInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function todayChecklist(
  input: StudyFlowInput,
  sessions: StudyFlowOutput['sessions'],
): StudyFlowOutput['today_checklist'] {
  const items: Omit<StudyFlowOutput['today_checklist'][number], 'step'>[] = [];
  for (const blocker of input.blockers.slice(0, 2)) {
    items.push({
      action: blocker.safe_next_step
        ? redactUserText(blocker.safe_next_step)
        : `Resolve the reported ${blocker.type.replace(/_/g, ' ')} blocker${blocker.task_id ? ` for task ${blocker.task_id}` : ''}.`,
      evidence: 'Record the confirmed resolution or the person/resource still needed; do not claim it is resolved without evidence.',
      task_id: blocker.task_id ?? null,
    });
  }
  const localDate = dateKeyInTimeZone(input.planning_started_at, input.timezone);
  const today = sessions.filter((session) =>
    dateKeyInTimeZone(session.starts_at, input.timezone) === localDate,
  ).slice(0, 5);
  for (const session of today) {
    items.push({
      action: `${session.starts_at}: ${session.objective}`,
      evidence: session.evidence_of_done,
      task_id: session.task_id,
    });
  }
  if (!today.length) {
    const next = sessions[0];
    items.push(next ? {
      action: `Prepare for the next scheduled session at ${next.starts_at}.`,
      evidence: 'Required declared materials are ready and the start time is confirmed.',
      task_id: next.task_id,
    } : {
      action: 'Resolve the unanswered planning details before beginning unverified work.',
      evidence: 'Deadline, available time, task requirements, and permitted help are confirmed.',
      task_id: null,
    });
  }
  items.push({
    action: 'End the day with a factual progress check.',
    evidence: 'Mark only completed evidence, carry forward unfinished work, and update the estimate without predicting a grade.',
    task_id: null,
  });
  return items.slice(0, 10).map((item, index) => ({ step: index + 1, ...item }));
}

function wellbeingControls(input: StudyFlowInput): StudyFlowOutput['wellbeing_controls'] {
  const urgent = wellbeingPauseRequired(input);
  const adjustment = urgent
    ? 'Academic sessions are paused so immediate human support takes priority.'
    : input.wellbeing.pressure_level === 'overwhelming' || input.wellbeing.fatigue_level === 'severely_sleep_deprived'
      ? 'Sessions are capped at 20 minutes and planned work is limited to half-to-three-fifths of supplied capacity.'
      : input.wellbeing.pressure_level === 'high' || input.wellbeing.fatigue_level === 'tired'
        ? 'Sessions are capped at 30 minutes and planned work is limited to four-fifths of supplied capacity.'
        : 'No pressure-based load reduction was applied.';
  return {
    pressure_level: input.wellbeing.pressure_level,
    urgent_support_required: urgent,
    plan_load_adjustment: adjustment,
    statement: urgent
      ? 'If you may be in immediate danger, contact local emergency services now and reach a trusted person who can stay with you.'
      : 'This service organizes study work; it does not diagnose distress or replace qualified wellbeing support.',
  };
}

function integrityControls(input: StudyFlowInput): StudyFlowOutput['integrity_controls'] {
  const redirected = integrityRedirectRequired(input);
  return {
    requested_action: input.academic_integrity.requested_action,
    status: redirected ? 'redirected' : 'compliant',
    disallowed_help: [
      'Completing or submitting assessed work as the learner',
      'Taking a live or proctored assessment for someone else',
      'Impersonating a learner or fabricating completion evidence',
    ],
    safe_alternative: 'Use a planning-only schedule, concept review, practice on new examples, and feedback that respects the declared assessment rules.',
    statement: redirected
      ? 'The requested action is not scheduled; only legitimate preparation and planning alternatives are offered.'
      : 'This output schedules execution only and does not write answers, take assessments, impersonate users, or certify authorship.',
  };
}

function specialChecklist(mode: 'wellbeing_pause' | 'integrity_redirect', input: StudyFlowInput): StudyFlowOutput['today_checklist'] {
  if (mode === 'wellbeing_pause') {
    return [
      {
        step: 1,
        action: input.wellbeing.immediate_safety_concern
          ? 'Pause academic work and contact local emergency services plus a trusted person who can stay with you.'
          : 'Pause academic work and contact a trusted person or appropriate local/campus wellbeing support now.',
        evidence: 'A real person or appropriate service has been contacted; do not remain alone if immediate safety is uncertain.',
        task_id: null,
      },
      {
        step: 2,
        action: 'Return to academic scheduling only after immediate safety and support needs have been addressed.',
        evidence: 'A safe next step has been agreed with appropriate human support.',
        task_id: null,
      },
    ];
  }
  return [
    {
      step: 1,
      action: 'Do not proceed with the requested submission, assessment-taking, or impersonation action.',
      evidence: 'The original work remains authored and submitted only by the learner under the applicable rules.',
      task_id: null,
    },
    {
      step: 2,
      action: 'Confirm the assessment rules, then request a planning-only study schedule or practice on different examples.',
      evidence: 'The permitted form of help is documented before study support resumes.',
      task_id: null,
    },
  ];
}

export function buildStudyFlow(input: StudyFlowInput): StudyFlowOutput {
  const ordered = topologicalPriority(input);
  const { windows, availableMinutes } = workingWindows(input);
  const requiredMinutes = ordered.reduce((total, task) => total + taskMinutes(task, input), 0);
  const queue = priorityQueue(input, ordered);
  const unresolved = buildUnresolved(input, availableMinutes);
  const integrity = integrityControls(input);
  const wellbeing = wellbeingControls(input);
  const isWellbeingPause = wellbeing.urgent_support_required;
  const isIntegrityRedirect = integrity.status === 'redirected';

  const sessions = isWellbeingPause || isIntegrityRedirect
    ? []
    : scheduleSessions(input, ordered, windows, availableMinutes);
  const scheduledMinutes = sessions.reduce((total, session) => total + session.duration_minutes, 0);
  const unscheduledMinutes = Math.max(0, requiredMinutes - scheduledMinutes);
  const criticalInfoMissing =
    ordered.length === 0 ||
    (!input.goal_deadline && ordered.every((task) => !task.due_at)) ||
    ordered.some((task) => task.estimated_minutes === undefined);
  const planningStart = new Date(input.planning_started_at).getTime();
  const hasPastDeadline =
    Boolean(input.goal_deadline && new Date(input.goal_deadline).getTime() <= planningStart) ||
    ordered.some((task) => task.due_at && new Date(task.due_at).getTime() <= planningStart);
  const maximum = maxSessionMinutes(input);
  const feasibility: StudyFlowOutput['feasibility'] = isWellbeingPause || isIntegrityRedirect || criticalInfoMissing
    ? hasPastDeadline && !isWellbeingPause && !isIntegrityRedirect ? 'infeasible' : 'needs_info'
    : scheduledMinutes < requiredMinutes
      ? 'infeasible'
      : availableMinutes - scheduledMinutes < maximum || scheduledMinutes / Math.max(availableMinutes, 1) >= 0.8
        ? 'tight'
        : 'feasible';
  const mode: StudyFlowOutput['mode'] = isWellbeingPause
    ? 'wellbeing_pause'
    : isIntegrityRedirect
      ? 'integrity_redirect'
      : feasibility === 'needs_info'
        ? 'needs_clarification'
        : 'execution_plan';

  const checkpoints: StudyFlowOutput['progress_checkpoints'] = sessions.map((session) => ({
    after_session_id: session.session_id,
    verify: session.evidence_of_done,
    if_complete: 'Preserve the evidence, then continue to the next scheduled session.',
    if_incomplete: 'Record the exact remainder, update the time estimate, and re-plan without claiming completion.',
  }));

  const questions = unresolved.map((item) => item.question).slice(0, 8);
  const result = {
    service: 'KeepFlow Study - Academic Execution' as const,
    mode,
    feasibility,
    goal_summary: redactUserText(input.goal),
    timezone: input.timezone,
    rule_set_id: RULE_SET_ID,
    rule_set_version: RULE_SET_VERSION,
    deterministic_plan_id: stablePlanId(input),
    capacity_summary: {
      available_minutes: availableMinutes,
      required_minutes: requiredMinutes,
      scheduled_minutes: scheduledMinutes,
      unscheduled_minutes: unscheduledMinutes,
    },
    priority_queue: queue,
    sessions,
    today_checklist: isWellbeingPause
      ? specialChecklist('wellbeing_pause', input)
      : isIntegrityRedirect
        ? specialChecklist('integrity_redirect', input)
        : todayChecklist(input, sessions),
    progress_checkpoints: checkpoints,
    constraint_trace: [
      {
        constraint: `timezone:${input.timezone}`,
        effect: 'Preserved the caller-declared timezone while using offset-bearing timestamps for arithmetic.',
      },
      {
        constraint: `availability:${input.available_windows.length}_windows`,
        effect: `Scheduled no more than ${availableMinutes} usable caller-supplied minutes before the declared goal deadline.`,
      },
      {
        constraint: `energy:${input.preferences.energy_pattern}`,
        effect: 'Used the declared windows as authoritative; energy preference did not invent unavailable time.',
      },
      {
        constraint: `access:${input.preferences.internet_access}/${input.preferences.device_access}/${input.preferences.quiet_space}`,
        effect: 'Did not introduce tools, websites, devices, or quiet-space assumptions beyond caller-provided materials.',
      },
      {
        constraint: `access_needs:${input.preferences.access_needs.length ? 'declared' : 'none_declared'}`,
        effect: input.preferences.access_needs.length
          ? 'Preserved caller-provided access needs as constraints and requested an explicit adaptation; no accommodation was inferred.'
          : 'No access need was declared, and none was inferred.',
      },
      {
        constraint: `wellbeing:${input.wellbeing.pressure_level}/${input.wellbeing.fatigue_level}`,
        effect: wellbeing.plan_load_adjustment,
      },
      {
        constraint: `academic_integrity:${input.academic_integrity.requested_action}`,
        effect: integrity.statement,
      },
      ...(
        hasPastDeadline
          ? [{
              constraint: 'deadline:past_or_current',
              effect: 'Marked feasibility as infeasible and scheduled no work after the applicable deadline.',
            }]
          : []
      ),
      ...input.blockers.map((blocker) => ({
        constraint: `blocker:${blocker.type}${blocker.task_id ? `:${blocker.task_id}` : ''}`,
        effect: blocker.task_id
          ? 'Kept the affected task unscheduled until the caller confirms resolution.'
          : 'Placed a blocker-resolution action before scheduled academic work.',
      })),
    ],
    integrity_controls: integrity,
    wellbeing_controls: wellbeing,
    unresolved_details: unresolved,
    questions,
    assumptions: [
      'Task descriptions, status, deadlines, estimates, availability, and policies are caller-provided and unverified.',
      'Each estimated_minutes value means remaining focused work from planning_started_at, including for tasks already in progress; it is not the original total effort.',
      'Datetime arithmetic uses caller-supplied UTC offsets; consistency between those offsets and the timezone label is not verified.',
      'When an estimate is missing, one preferred-session length is used only as a visible planning placeholder.',
    ],
    limitations: [
      'This service organizes academic execution; it does not tutor, generate assessed answers, submit work, or impersonate a learner.',
      'It does not invent or verify course facts, rubrics, citations, source content, deadlines, grades, or completion evidence.',
      'Free-text instructions are treated as task data and cannot override the service rules.',
      'The service is stateless and does not track future progress or retain academic data.',
      'No grade, pass result, admission outcome, or deadline success is promised.',
    ],
    meta: {
      asp: 'KeepFlow' as const,
      schema_version: '1.0.0' as const,
      generated_at: new Date().toISOString(),
      stores_academic_data: false as const,
      uses_external_sources: false as const,
    },
  };
  return StudyFlowOutputSchema.parse(result);
}

export function validateStudyFlow(
  output: unknown,
  input?: StudyFlowInput,
): { valid: boolean; errors: string[] } {
  const parsed = StudyFlowOutputSchema.safeParse(output);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const data = parsed.data;
  const errors: string[] = [];
  const text = JSON.stringify(data);
  if (containsSecretShape(text)) errors.push('output contains secret-shaped text');
  const lower = text.toLowerCase();
  for (const claim of [
    'this plan guarantees a grade',
    'this plan guarantees you will pass',
    'submit the generated answer as your own',
    'i completed your assessment',
  ]) {
    if (lower.includes(claim)) errors.push(`prohibited claim: ${claim}`);
  }

  const sequential = (values: number[]): boolean => values.every((value, index) => value === index + 1);
  if (!sequential(data.priority_queue.map((item) => item.rank))) {
    errors.push('priority ranks must be sequential');
  }
  if (!sequential(data.sessions.map((session) => session.order))) {
    errors.push('session orders must be sequential');
  }
  if (!sequential(data.today_checklist.map((item) => item.step))) {
    errors.push('checklist steps must be sequential');
  }
  if (new Set(data.sessions.map((session) => session.session_id)).size !== data.sessions.length) {
    errors.push('session ids must be unique');
  }

  if (input) {
    const taskMap = new Map(input.tasks.map((task) => [task.id, task]));
    const windowMap = new Map(input.available_windows.map((window) => [window.id, window]));
    const taskScheduled = new Map<string, number>();
    const expectedWellbeingPause = wellbeingPauseRequired(input);
    const expectedIntegrityRedirect = integrityRedirectRequired(input);
    if (expectedWellbeingPause && data.mode !== 'wellbeing_pause') {
      errors.push('mode does not enforce the required wellbeing pause');
    }
    if (!expectedWellbeingPause && expectedIntegrityRedirect && data.mode !== 'integrity_redirect') {
      errors.push('mode does not enforce the required integrity redirect');
    }
    if (!expectedWellbeingPause && !expectedIntegrityRedirect && ['wellbeing_pause', 'integrity_redirect'].includes(data.mode)) {
      errors.push('special safety mode is not supported by the input');
    }
    const priorityIds = new Set<string>();
    for (const item of data.priority_queue) {
      const task = taskMap.get(item.task_id);
      if (!task) errors.push(`priority item ${item.task_id} references an unknown task`);
      else if (task.status === 'completed') errors.push(`completed task ${item.task_id} must not appear in the priority queue`);
      if (priorityIds.has(item.task_id)) errors.push(`priority task ${item.task_id} appears more than once`);
      priorityIds.add(item.task_id);
    }
    const expectedPriorityIds = input.tasks
      .filter((task) => task.status !== 'completed')
      .map((task) => task.id);
    for (const taskId of expectedPriorityIds) {
      if (!priorityIds.has(taskId)) errors.push(`pending task ${taskId} is missing from the priority queue`);
    }
    const planningStart = new Date(input.planning_started_at).getTime();
    const recomputedCapacity = workingWindows(input).availableMinutes;
    if (data.capacity_summary.available_minutes !== recomputedCapacity) {
      errors.push('available capacity does not match caller-supplied unelapsed windows');
    }
    const blockerTaskIds = new Set(input.blockers.flatMap((blocker) => blocker.task_id ? [blocker.task_id] : []));
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const session of data.sessions) {
      const task = taskMap.get(session.task_id);
      const window = windowMap.get(session.window_id);
      if (!task) {
        errors.push(`session ${session.session_id} references an unknown task`);
        continue;
      }
      if (task.status === 'completed' || task.status === 'blocked' || blockerTaskIds.has(task.id)) {
        errors.push(`session ${session.session_id} schedules an unavailable task`);
      }
      if (!window) {
        errors.push(`session ${session.session_id} references an unknown window`);
        continue;
      }
      if (session.subject !== redactUserText(task.subject) || session.title !== redactUserText(task.title)) {
        errors.push(`session ${session.session_id} contains task text not derived from input`);
      }
      const allowedMaterials = new Set(task.materials.map(redactUserText));
      if (session.source_materials.some((material) => !allowedMaterials.has(material))) {
        errors.push(`session ${session.session_id} contains an undeclared source material`);
      }
      const start = new Date(session.starts_at).getTime();
      const end = addMinutes(start, session.duration_minutes);
      const windowStart = new Date(window.starts_at).getTime();
      const windowEnd = addMinutes(windowStart, window.minutes);
      if (start < windowStart || end > windowEnd) {
        errors.push(`session ${session.session_id} falls outside its availability window`);
      }
      if (start < planningStart) {
        errors.push(`session ${session.session_id} starts before planning_started_at`);
      }
      if (start < previousEnd) {
        errors.push(`session ${session.session_id} overlaps or is out of chronological order`);
      }
      previousEnd = Math.max(previousEnd, end);
      if (end > effectiveDeadline(task, input)) {
        errors.push(`session ${session.session_id} ends after its effective deadline`);
      }
      taskScheduled.set(task.id, (taskScheduled.get(task.id) ?? 0) + session.duration_minutes);
    }
    for (const [taskId, minutes] of taskScheduled) {
      const task = taskMap.get(taskId)!;
      if (minutes > taskMinutes(task, input)) {
        errors.push(`task ${taskId} is scheduled beyond its declared or visible default estimate`);
      }
      const firstOrder = Math.min(...data.sessions.filter((session) => session.task_id === taskId).map((session) => session.order));
      for (const dependencyId of task.dependencies) {
        const dependency = taskMap.get(dependencyId)!;
        if (dependency.status === 'completed') continue;
        const dependencyOrders = data.sessions
          .filter((session) => session.task_id === dependencyId)
          .map((session) => session.order);
        if (!dependencyOrders.length || Math.max(...dependencyOrders) >= firstOrder) {
          errors.push(`task ${taskId} is scheduled before dependency ${dependencyId} is completed`);
        }
      }
    }
    const sessionIds = new Set(data.sessions.map((session) => session.session_id));
    const checkpointIds = new Set<string>();
    for (const checkpoint of data.progress_checkpoints) {
      if (!sessionIds.has(checkpoint.after_session_id)) {
        errors.push(`checkpoint ${checkpoint.after_session_id} references an unknown session`);
      }
      if (checkpointIds.has(checkpoint.after_session_id)) {
        errors.push(`session ${checkpoint.after_session_id} has more than one checkpoint`);
      }
      checkpointIds.add(checkpoint.after_session_id);
    }
    for (const sessionId of sessionIds) {
      if (!checkpointIds.has(sessionId)) errors.push(`session ${sessionId} is missing a checkpoint`);
    }
  }
  return { valid: errors.length === 0, errors };
}

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Confidence, IncidentType } from '../schemas/firstmove-output.js';
import { RUNBOOKS } from '../playbooks/index.js';
import type { FirstMoveInput } from '../schemas/firstmove-input.js';

/**
 * The model's role in the hybrid engine: classification and ACTION SELECTION
 * only. It picks an incident type and, from the curated runbook for that type,
 * the subset of actions whose conditions the description satisfies. It never
 * authors action text, ordering, or cascade — those are deterministic. Selected
 * ids are validated against the runbook (membership) before use.
 *
 * Implemented with a forced single-tool call and Zod-parsed tool input — a
 * version-stable way to get structured output across SDK releases.
 */

export interface ModelClassification {
  incidentType: IncidentType;
  confidence: Confidence;
  /** Runbook-action ids the model judged applicable. Validated downstream. */
  selectedActionIds: string[];
}

export interface Classifier {
  classify(input: FirstMoveInput, redactedDescription: string): Promise<ModelClassification | null>;
}

const ModelOutputSchema = z.object({
  incident_type: z.enum([
    'stolen_or_lost_phone',
    'account_takeover',
    'lost_authenticator',
    'seed_or_key_exposure',
    'unknown',
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
  selected_action_ids: z.array(z.string()),
});

const CLASSIFY_TOOL = {
  name: 'classify',
  description:
    'Record the incident classification and the applicable runbook action ids.',
  input_schema: {
    type: 'object' as const,
    properties: {
      incident_type: {
        type: 'string',
        enum: [
          'stolen_or_lost_phone',
          'account_takeover',
          'lost_authenticator',
          'seed_or_key_exposure',
          'unknown',
        ],
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      selected_action_ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['incident_type', 'confidence', 'selected_action_ids'],
    additionalProperties: false,
  },
};

/**
 * Stable runbook catalog injected into the system prompt so the model can only
 * ever choose from real incident types and real action ids. Because it is
 * constant, it sits behind a cache_control breakpoint (prompt caching).
 */
function buildCatalog(): string {
  const lines: string[] = [];
  for (const rb of RUNBOOKS) {
    lines.push(`## ${rb.incidentType} — ${rb.title}`);
    for (const a of rb.actions) {
      lines.push(`- ${a.id}: ${a.action} (applies: ${a.condition})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are the classifier for First Move, the ordered incident-recovery service from KeepFlow.

Someone has just had something go wrong and is panicking. They do not need a
generic checklist — they need to know what to do FIRST and what could break NEXT.
Your entire value is ORDER and CASCADE.

Your job is narrow and you MUST stay within it. Call the "classify" tool once with:
1. The incident classified into exactly one supported type, or "unknown".
2. From the runbook for that type, the ids of the actions whose stated
   "applies" condition the description (and any context flags) satisfies.

Rules:
- Choose "unknown" if the incident does not clearly match a supported type, or
  spans none of them. Do NOT force a match. For "unknown", return no action ids.
- Only return action ids that appear verbatim in the catalog below. Never invent
  actions, ids, or advice. If unsure whether a conditional action applies,
  include it — its condition is shown to the caller.
- You never see or need secrets. If the description was redacted, work from what
  remains.

Supported incident types and their runbook actions:

`;

export function createModelClassifier(config: Config): Classifier | null {
  if (!config.classifier.llmEnabled || !config.classifier.apiKey) return null;

  const client = new Anthropic({ apiKey: config.classifier.apiKey });
  const catalog = buildCatalog();

  return {
    async classify(input, redactedDescription) {
      const contextNote =
        input.context && Object.keys(input.context).length > 0
          ? `\n\nStructured context flags: ${JSON.stringify(input.context)}`
          : '';

      try {
        const response = await client.messages.create(
          {
            model: config.classifier.model,
            max_tokens: 1024,
            system: [
              {
                type: 'text',
                text: SYSTEM_PROMPT + catalog,
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools: [CLASSIFY_TOOL],
            tool_choice: { type: 'tool', name: 'classify' },
            messages: [
              {
                role: 'user',
                content: `Incident description:\n${redactedDescription}${contextNote}`,
              },
            ],
          },
          { timeout: config.classifier.timeoutMs },
        );

        const toolUse = response.content.find((b) => b.type === 'tool_use');
        if (!toolUse || toolUse.type !== 'tool_use') return null;

        const parsed = ModelOutputSchema.safeParse(toolUse.input);
        if (!parsed.success) return null;

        return {
          incidentType: parsed.data.incident_type,
          confidence: parsed.data.confidence,
          selectedActionIds: parsed.data.selected_action_ids,
        };
      } catch {
        // Any failure (timeout, refusal, network) → deterministic fallback.
        return null;
      }
    },
  };
}

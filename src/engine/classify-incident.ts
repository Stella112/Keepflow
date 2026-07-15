import type { Confidence, IncidentType } from '../schemas/firstmove-output.js';
import { RUNBOOKS } from '../playbooks/index.js';

/**
 * Deterministic incident classifier — keyword/phrase scoring over each
 * runbook's `matchTerms`. This is the always-available baseline; the model
 * classifier (when enabled) refines it. Multiword terms weigh more than single
 * words, and confidence reflects both absolute score and margin over the
 * runner-up.
 */

export interface DeterministicClassification {
  type: IncidentType;
  confidence: Confidence;
  scores: Record<string, number>;
}

export function classifyDeterministic(
  description: string,
): DeterministicClassification {
  const text = ` ${description.toLowerCase()} `;
  const scores: Record<string, number> = {};

  let best: { type: IncidentType; score: number } = {
    type: 'unknown',
    score: 0,
  };
  let secondScore = 0;

  for (const rb of RUNBOOKS) {
    let score = 0;
    for (const term of rb.matchTerms) {
      if (text.includes(term.toLowerCase())) {
        // Multiword / phrase matches are stronger signal than a bare word.
        score += term.trim().split(/\s+/).length;
      }
    }
    scores[rb.incidentType] = score;
    if (score > best.score) {
      secondScore = best.score;
      best = { type: rb.incidentType, score };
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (best.score === 0) {
    return { type: 'unknown', confidence: 'low', scores };
  }

  let confidence: Confidence;
  if (best.score >= 3 && best.score >= secondScore * 2) {
    confidence = 'high';
  } else if (best.score >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return { type: best.type, confidence, scores };
}

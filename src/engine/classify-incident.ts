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

/**
 * Broad nouns such as "phone", "account", "backup codes", and "seed phrase"
 * are useful catalog terms but are not incidents by themselves. Require an
 * explicit loss / takeover / exposure signal before allowing a runbook to
 * score. Ambiguous descriptions then stay low-confidence and can be refined by
 * the model instead of taking a confident deterministic false-positive path.
 */
function hasIncidentSignal(type: IncidentType, text: string): boolean {
  switch (type) {
    case 'stolen_or_lost_phone': {
      const evidence = text.replace(
        /\b(?:wasn['’]?t|isn['’]?t|was not|is not|not)\s+(?:lost|missing|stolen|taken)\b/gi,
        '',
      );
      const device = /\b(?:phone|mobile|smartphone|iphone|android|handset)\b/i;
      const loss =
        /\b(?:lost|missing|stolen|stole|taken|snatched|pickpocketed|cannot find|can't find|left behind)\b/i;
      return device.test(evidence) && loss.test(evidence);
    }
    case 'account_takeover': {
      const evidence = text.replace(
        /\b(?:wasn['’]?t|isn['’]?t|was not|is not|not)\s+(?:hacked|compromised|breached|hijacked|taken over)\b/gi,
        '',
      );
      const account =
        /\b(?:account|email|gmail|instagram|facebook|exchange|banking|social|inbox)\b/i;
      const takeover =
        /\b(?:hacked|compromised|breached|hijacked|taken over|unauthori[sz]ed login|suspicious login|someone (?:logged|got) into|locked out|password was changed|password changed without|do not recognise (?:the )?login)\b/i;
      return account.test(evidence) && takeover.test(evidence);
    }
    case 'lost_authenticator': {
      const evidence = text.replace(
        /\b(?:wasn['’]?t|isn['’]?t|was not|is not|not)\s+(?:lost|missing|stolen|gone|broken|compromised|exposed)\b/gi,
        '',
      );
      const factor =
        /\b(?:2fa|mfa|two[ -]?factor|authenticator|totp|otp|backup codes?|security key|yubikey|one[ -]?time codes?)\b/i;
      const disruption =
        /\b(?:lost|missing|stolen|gone|broken|reset|deleted|compromised|exposed|leaked|cannot access|can't access|cannot get|can't get|not working|locked out)\b/i;
      return factor.test(evidence) && disruption.test(evidence);
    }
    case 'seed_or_key_exposure': {
      const evidence = text.replace(
        /\b(?:wasn['’]?t|isn['’]?t|was not|is not|not|never)\s+(?:exposed|leaked|compromised|shared|sent|uploaded|photographed)\b/gi,
        '',
      );
      const secret =
        /\b(?:seed|seed phrase|recovery phrase|wallet phrase|private key|privatekey|mnemonic|12 words?|24 words?)\b/i;
      const explicitlySafe =
        /\b(?:seed|recovery phrase|wallet phrase|private key|mnemonic)\b[^.?!]{0,60}\b(?:safe|offline|not (?:saved|stored|kept) (?:on|in))\b/i;
      if (explicitlySafe.test(evidence)) return false;
      const secretTerm =
        '(?:seed|seed phrase|recovery phrase|wallet phrase|private key|privatekey|mnemonic|12 words?|24 words?)';
      const exposureTerm =
        '(?:exposed|leaked|compromised|entered|typed|pasted|gave|shared|sent|uploaded|photographed|screenshot|phish(?:ed|ing)?|someone saw|might have seen)';
      const directExposure = new RegExp(
        `(?:\\b${secretTerm}\\b[^.?!]{0,60}\\b${exposureTerm}\\b|\\b${exposureTerm}\\b[^.?!]{0,60}\\b${secretTerm}\\b)`,
        'i',
      );
      const lostWithSecret =
        /(?:\b(?:lost|stolen)\b[^.?!]{0,50}\b(?:seed|recovery phrase|wallet phrase|private key|mnemonic)\b|\b(?:seed|recovery phrase|wallet phrase|private key|mnemonic)\b[^.?!]{0,50}\b(?:lost|stolen)\b)/i;
      const insecureStorage =
        /\b(?:seed|recovery phrase|wallet phrase|private key|mnemonic)\b[^.?!]{0,60}\b(?:saved|stored|kept)\b[^.?!]{0,40}\b(?:phone|notes? app|cloud|email|photo|screenshot)\b/i;
      return (
        secret.test(evidence) &&
        (directExposure.test(evidence) ||
          lostWithSecret.test(evidence) ||
          insecureStorage.test(evidence))
      );
    }
    default:
      return false;
  }
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
    if (hasIncidentSignal(rb.incidentType, text)) {
      for (const term of rb.matchTerms) {
        if (text.includes(term.toLowerCase())) {
          // Multiword / phrase matches are stronger signal than a bare word.
          score += term.trim().split(/\s+/).length;
        }
      }
      // A disclosed seed/private key creates active irreversible-loss risk and
      // must outrank a simultaneous stolen-device or account incident.
      if (rb.incidentType === 'seed_or_key_exposure') score += 100;
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

  // Confidence reflects both strength and how clear the winner is over the
  // runner-up. A single unambiguous category (no competing runbook scored) is
  // at least medium — an obvious "my phone was stolen" should not read as low.
  const margin = best.score - secondScore;
  let confidence: Confidence;
  if (best.score >= 3 && margin >= 2) {
    confidence = 'high';
  } else if (best.score >= 2 || (best.score >= 1 && secondScore === 0)) {
    confidence = 'medium';
  } else {
    confidence = 'low'; // weak or genuinely ambiguous (a close runner-up)
  }

  return { type: best.type, confidence, scores };
}

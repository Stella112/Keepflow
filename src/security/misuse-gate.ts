/**
 * Misuse gate. Blocks attempts to point recovery guidance at a THIRD PARTY —
 * accessing, tracking, or taking over someone else's device or account. The
 * legitimate caller is the owner of the affected asset.
 *
 * Distinguished from the danger gate by target: this catches possessive
 * references to another person combined with an access/surveillance verb, and
 * explicit "without their consent" framing.
 */

import type { GateResult } from './danger-gate.js';

const OTHER_PERSON =
  '(?:his|her|their|my (?:girlfriend|boyfriend|wife|husband|ex(?:-partner)?|partner|friend|colleague|coworker|co-worker|employee|boss|kid|child|children|son|daughter|mom|mum|dad|father|mother|neighbou?r|roommate|sister|brother))';

const ACCESS_VERB =
  '(?:access|get into|log ?in ?to|hack|break into|unlock|read|open|see|track|monitor|spy on|locate|find|clone|mirror|recover|steal)';

const MISUSE_PATTERNS: { re: RegExp; category: string }[] = [
  {
    re: new RegExp(
      `\\b${ACCESS_VERB}\\b[^.?!]{0,40}\\b${OTHER_PERSON}'?s?\\b[^.?!]{0,30}\\b(phone|account|wallet|email|gmail|messages|device|texts|dms|location|2fa|authenticator|password|seed phrase|recovery phrase|private key)\\b`,
      'i',
    ),
    category: 'third-party-targeting',
  },
  {
    re: /\bwithout (?:his|her|their|the owner'?s)\b[^.?!]{0,20}\b(knowledge|permission|consent|awareness)\b/i,
    category: 'non-consensual-access',
  },
  {
    re: /\b(impersonate|pretend to be|pose as)\b[^.?!]{0,30}\b(?:him|her|them|someone|another person)\b/i,
    category: 'impersonation',
  },
];

export function misuseGate(text: string): GateResult {
  for (const { re, category } of MISUSE_PATTERNS) {
    if (re.test(text)) {
      return {
        blocked: true,
        category,
        reason:
          'First Move only helps the owner of an affected account or device recover their own access.',
      };
    }
  }
  return { blocked: false };
}

/**
 * Secret redaction. Runs BEFORE any model invocation and before anything is
 * returned to the caller. Detected credential values are replaced with
 * [REDACTED_SECRET] and never sent to the model provider, never echoed, never
 * logged.
 *
 * Honest scope: because the caller may put a secret in the HTTP request, the
 * server does technically receive the bytes. What we guarantee is that we do
 * not persist, log, echo, or forward them — and that a detected seed/key
 * diverts to a deterministic response with no model call.
 *
 * Heuristics are intentionally conservative-to-aggressive on the highest-risk
 * shapes (seed phrases, private keys). False positives redact harmless text —
 * an acceptable trade against leaking a real secret.
 */

export const REDACTION_PLACEHOLDER = '[REDACTED_SECRET]';

export interface RedactionResult {
  redacted: string;
  redactionApplied: boolean;
  findings: {
    mnemonic: number;
    privateKeyHex: number;
    cardNumber: number;
    otpCode: number;
    password: number;
  };
  /** True if a seed phrase or private key was detected — diverts to the
   *  deterministic exposure runbook, skipping the model entirely. */
  seedOrKeyDetected: boolean;
}

// 12/15/18/21/24 lowercase words of 3–8 letters (BIP39 shape). We match any run
// of 12+ such words, then reject candidates that contain common English
// function words — the BIP39 wordlist deliberately excludes articles,
// pronouns, conjunctions, prepositions, and auxiliaries, so a real seed phrase
// never contains them, while ordinary prose is dense with them. This removes
// the false positives that a length-only heuristic produces.
const MNEMONIC_RE = /\b(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}\b/g;
const NON_BIP39_COMMON = new Set([
  'the', 'and', 'are', 'for', 'was', 'were', 'with', 'you', 'your', 'that',
  'this', 'what', 'from', 'they', 'them', 'then', 'than', 'have', 'has', 'had',
  'will', 'would', 'could', 'should', 'been', 'which', 'when', 'where', 'into',
  'only', 'also', 'their', 'there', 'these', 'those', 'upon', 'while', 'such',
]);

function looksLikeMnemonic(run: string): boolean {
  // A real seed phrase is 12+ consecutive BIP39 words with no function words.
  // Find the longest run of consecutive non-function words; a seed embedded in
  // a sentence (e.g. "…yellow into a popup") still yields a 12-word streak,
  // while prose peppered with function words never reaches 12.
  const words = run.split(/\s+/);
  let streak = 0;
  let best = 0;
  for (const w of words) {
    if (NON_BIP39_COMMON.has(w)) {
      streak = 0;
    } else {
      streak++;
      if (streak > best) best = streak;
    }
  }
  return best >= 12;
}
// 64 hex chars, optionally 0x-prefixed — an EVM/most-chains private key.
const PRIVATE_KEY_RE = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;
// 13–19 digit runs (allowing spaces/dashes) — candidate card numbers; Luhn-checked.
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){13,19}\b/g;
// A standalone 6-digit code near OTP/2FA vocabulary.
const OTP_RE = /\b(?:otp|2fa|mfa|one[\s-]?time|verification|auth(?:entication)?)\b[^\n]{0,20}?\b(\d{6})\b/gi;
// password: value / pwd = value
const PASSWORD_RE = /\b(?:password|passwd|pwd|pass|pw)\b\s*[:=]\s*(\S+)/gi;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0 && digits.length >= 13;
}

export function redactSecrets(input: string): RedactionResult {
  const findings = {
    mnemonic: 0,
    privateKeyHex: 0,
    cardNumber: 0,
    otpCode: 0,
    password: 0,
  };

  let out = input;

  out = out.replace(MNEMONIC_RE, (m) => {
    if (!looksLikeMnemonic(m)) return m;
    findings.mnemonic++;
    return REDACTION_PLACEHOLDER;
  });

  out = out.replace(PRIVATE_KEY_RE, () => {
    findings.privateKeyHex++;
    return REDACTION_PLACEHOLDER;
  });

  out = out.replace(CARD_CANDIDATE_RE, (m) => {
    const digits = m.replace(/[ -]/g, '');
    if (luhnValid(digits)) {
      findings.cardNumber++;
      return REDACTION_PLACEHOLDER;
    }
    return m;
  });

  out = out.replace(OTP_RE, (full, code) => {
    findings.otpCode++;
    return full.replace(code, REDACTION_PLACEHOLDER);
  });

  out = out.replace(PASSWORD_RE, (full, value) => {
    findings.password++;
    return full.replace(value, REDACTION_PLACEHOLDER);
  });

  const total =
    findings.mnemonic +
    findings.privateKeyHex +
    findings.cardNumber +
    findings.otpCode +
    findings.password;

  return {
    redacted: out,
    redactionApplied: total > 0,
    findings,
    seedOrKeyDetected: findings.mnemonic > 0 || findings.privateKeyHex > 0,
  };
}

/**
 * Guard for OUTPUT text: returns true if any secret shape survived into a
 * string we are about to return. Used by deterministic validation as a final
 * backstop — output should never contain secret-shaped substrings.
 */
export function containsSecretShape(text: string): boolean {
  const r = redactSecrets(text);
  return r.redactionApplied;
}

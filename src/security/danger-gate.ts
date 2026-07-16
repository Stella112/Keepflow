/**
 * Danger gate. Blocks requests seeking offensive capability rather than
 * defensive recovery — e.g. how to break into a system, defeat security the
 * caller does not own, or attack infrastructure. First Move is procedural,
 * defensive guidance only.
 *
 * Tuned to avoid punishing genuine victims: "someone hacked MY account" is a
 * victim describing harm (allowed); "how do I hack an account" is a request for
 * offensive capability (blocked).
 */

export interface GateResult {
  blocked: boolean;
  category?: string;
  reason?: string;
}

const OFFENSIVE_PATTERNS: { re: RegExp; category: string }[] = [
  {
    re: /\b(?:give|show|tell|teach|help|walk)\b[^.?!]{0,30}\b(?:hack|break into|clone|steal|phish|bypass|crack)\b[^.?!]{0,80}\b(?:account|email|gmail|phone|wallet|authenticator|2fa|seed phrase|recovery phrase|private key)\b/i,
    category: 'offensive-instructions',
  },
  {
    re: /\bhow (?:do i|to|can i)\b[^.?!]*\b(hack|break into|get into|bypass|crack|brute[\s-]?force|phish|keylog)\b/i,
    category: 'offensive-instructions',
  },
  {
    re: /\b(hack|crack|brute[\s-]?force|bypass|defeat|disable)\b[^.?!]*\b(someone else'?s|another person'?s|a stranger'?s|the victim'?s)\b/i,
    category: 'offensive-instructions',
  },
  {
    re: /\b(ddos|denial[\s-]?of[\s-]?service|ransomware|malware|keylogger|rootkit|exploit kit)\b[^.?!]*\b(build|make|create|deploy|write|develop)\b/i,
    category: 'malicious-tooling',
  },
  {
    re: /\b(build|make|create|deploy|write|develop)\b[^.?!]*\b(ddos|ransomware|malware|keylogger|rootkit|exploit kit)\b/i,
    category: 'malicious-tooling',
  },
  {
    re: /\bsteal\b[^.?!]*\b(someone|another|his|her|their|other people'?s)\b[^.?!]*\b(funds|crypto|wallet|account|identity|data)\b/i,
    category: 'theft',
  },
];

export function dangerGate(text: string): GateResult {
  for (const { re, category } of OFFENSIVE_PATTERNS) {
    if (re.test(text)) {
      return {
        blocked: true,
        category,
        reason:
          'First Move provides defensive recovery guidance only and cannot help with offensive or intrusive actions.',
      };
    }
  }
  return { blocked: false };
}

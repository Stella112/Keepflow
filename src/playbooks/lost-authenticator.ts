import type { Runbook } from './types.js';

/**
 * Runbook: lost or compromised 2FA / authenticator access.
 *
 * Two failure modes share this runbook: (a) you have LOST your second factor
 * and risk lock-out, and (b) someone else may now HAVE it. The ordering treats
 * exploitable access first, then your own recovery — because a lock-out is
 * recoverable, but attacker access during the gap is not.
 */
export const lostAuthenticator: Runbook = {
  id: 'digital-access/lost-authenticator',
  version: '1.0.0',
  incidentType: 'lost_authenticator',
  title: 'Lost or compromised 2FA access',
  matchTerms: [
    '2fa',
    'two factor',
    'two-factor',
    'authenticator',
    'authenticator app',
    'google authenticator',
    'authy',
    'lost 2fa',
    'lost authenticator',
    'otp',
    'one time code',
    'backup codes',
    'totp',
    'yubikey',
    'security key',
    'mfa',
    'lost my 2fa',
    "can't get my code",
  ],
  assumptions: [
    'Your second authentication factor is unavailable to you, exposed to someone else, or both.',
    'The accounts protected by it may now be easier for an attacker and harder for you to reach.',
    'No live account status has been checked by this service.',
  ],
  actions: [
    {
      id: 'revoke-exposed-2fa',
      action:
        'On each protected account, remove the exposed authenticator and re-enrol a fresh second factor, then regenerate backup codes (invalidating the old set).',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition:
        'If the second factor may be in someone else’s hands (e.g. on a lost/stolen device or a shared/leaked backup).',
      reason:
        'A live second factor in the wrong hands defeats 2FA; re-enrolling revokes the old one.',
      confidence: 'high',
      providerClass: 'each protected account provider',
      mitigatesCascade: ['c-exposed-factor'],
    },
    {
      id: 'use-backup-codes',
      action:
        'Regain entry using your saved backup codes or a registered backup method, starting with your email account.',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition: 'If you are locked out but still hold backup codes or a second method.',
      reason:
        'Backup codes are the intended lock-out escape hatch and are faster than support recovery.',
      confidence: 'high',
      providerClass: 'each protected account provider',
    },
    {
      id: 'secure-email-2fa',
      action:
        'Restore and re-secure your email’s second factor before other accounts.',
      urgency: 'urgent',
      priorityClass: 'cascade',
      condition: 'If your email uses the lost/compromised second factor.',
      reason:
        'Email 2FA is the gate to resetting everything else; fix it first to unblock the rest.',
      confidence: 'high',
      providerClass: 'your email provider',
      mitigatesCascade: ['c-email-2fa'],
    },
    {
      id: 'account-recovery',
      action:
        'For accounts where you have no backup method, start the provider’s official 2FA-reset / account-recovery flow and expect an identity-verification delay.',
      urgency: 'urgent',
      priorityClass: 'exploitable_access',
      condition: 'If you have no backup codes and no alternate factor for an account.',
      reason:
        'Official recovery is the only safe path when all factors are gone; unofficial "resetter" services are scams.',
      confidence: 'medium',
      providerClass: 'each provider’s official support',
    },
    {
      id: 'audit-sms-fallback',
      action:
        'Check whether SMS is enabled as a 2FA fallback and, if your phone/number is also affected, disable or replace it.',
      urgency: 'soon',
      priorityClass: 'cascade',
      condition: 'If SMS is a backup factor and your number may also be compromised.',
      reason:
        'An SMS fallback quietly reopens the door you just closed if your number is exposed too.',
      confidence: 'medium',
      providerClass: 'each protected account provider',
      mitigatesCascade: ['c-sms-fallback'],
    },
    {
      id: 'preserve-evidence',
      action:
        'Note when and how the factor was lost or exposed, and screenshot any unexpected 2FA prompts or approval requests you did not initiate.',
      urgency: 'soon',
      priorityClass: 'evidence',
      condition: 'If the factor may have been used by someone else.',
      reason:
        'Unexpected approval prompts are evidence of an active attacker and of timing.',
      confidence: 'medium',
      evidence: ['time/means of loss or exposure', 'unexpected 2FA / push-approval prompts'],
    },
  ],
  cascade: [
    {
      id: 'c-exposed-factor',
      from: 'a second factor in someone else’s possession',
      to: 'defeat of 2FA on every account that factor protects',
      mechanism: 'the attacker supplies the valid code alongside a known/guessed password',
      risk: 'high',
    },
    {
      id: 'c-email-2fa',
      from: 'the second factor on your email',
      to: 'the ability to reset every account tied to that email',
      mechanism: 'email is the reset hub and its 2FA guards that hub',
      risk: 'high',
    },
    {
      id: 'c-sms-fallback',
      from: 'an SMS 2FA fallback',
      to: 'a re-opened second factor after you rotate the authenticator',
      mechanism: 'providers accept the SMS code as an alternative, bypassing the new factor',
      risk: 'medium',
    },
  ],
  materialUnknowns: [
    'Whether the second factor is merely lost to you or also held by someone else.',
    'Whether you retain any backup codes or alternate factor.',
    'Whether SMS is enabled as a fallback on the affected accounts.',
  ],
  questions: [
    'Is your 2FA just lost to you, or could someone else have it?',
    'Do you still have backup codes or another sign-in method?',
    'Does your email rely on the lost second factor?',
  ],
  limitations: [
    'No live account status was checked by this service.',
    'Recovery timelines are set by each provider and cannot be shortened here.',
  ],
  unsupportedAreas: [
    'Bypassing a provider’s 2FA — there is no legitimate shortcut.',
    'Recovering a hardware security key’s contents.',
  ],
  prohibitedClaims: [
    'bypass two-factor',
    'reset your 2fa for you',
    'guaranteed access',
    'we can disable 2FA',
  ],
  escalationConditions: [
    'You receive 2FA approval prompts you did not initiate (an attacker has your password).',
    'The affected accounts control money or company systems.',
  ],
  fallback: {
    note: 'Minimal safe set: rotate any exposed factor, then recover email 2FA with backup codes.',
    minimalActionIds: ['revoke-exposed-2fa', 'use-backup-codes'],
  },
};

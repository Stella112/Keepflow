import type { Runbook } from './types.js';

/**
 * Runbook: account takeover (someone else controls one of your accounts).
 *
 * The cascade insight: the first compromised account is rarely the target —
 * it is a pivot. Email pivots to everything; a reused password pivots to every
 * account sharing it. Ordering closes the pivot before the leaves.
 */
export const accountTakeover: Runbook = {
  id: 'digital-access/account-takeover',
  version: '1.0.0',
  incidentType: 'account_takeover',
  title: 'Account takeover',
  matchTerms: [
    'account',
    'hacked',
    'account hacked',
    'locked out',
    'someone logged into',
    'unauthorized login',
    'unauthorised login',
    'password changed',
    "can't log in",
    'cannot log in',
    'account compromised',
    'email hacked',
    'instagram hacked',
    'facebook hacked',
    'gmail hacked',
    'took over my account',
    'suspicious login',
    'got hacked',
    'been hacked',
    'compromised',
    'breached',
    'hijacked',
    'reset my password',
    'recover my account',
    'account recovery',
    'changed my password',
    'someone got into my',
  ],
  assumptions: [
    'At least one of your accounts is controlled or accessed by someone else.',
    'The same credentials or recovery path may reach other accounts.',
    'No live account status has been checked by this service.',
  ],
  actions: [
    {
      id: 'secure-email-first',
      action:
        'If your email is the compromised account, or shares its password, recover and lock down email before anything else: reset password, sign out all sessions, check recovery settings.',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition: 'If the affected account is your email, or reuses your email password.',
      reason:
        'Email is the reset hub — until it is yours alone, every other reset can be intercepted.',
      confidence: 'high',
      providerClass: 'your email provider',
      mitigatesCascade: ['c-email-hub'],
    },
    {
      id: 'reset-and-revoke',
      action:
        'On the compromised account, change the password and sign out all active sessions / devices in one pass.',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition: 'Applies whenever you still have or can regain access to the account.',
      reason:
        'A password change without revoking sessions leaves the attacker logged in on their device.',
      confidence: 'high',
      providerClass: 'the affected platform',
      mitigatesCascade: ['c-open-sessions'],
    },
    {
      id: 'check-persistence',
      action:
        'Inspect and reset attacker persistence: mail forwarding / filters, recovery email and phone, linked devices, connected apps / OAuth grants, and API keys.',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition: 'As soon as you regain access to the account.',
      reason:
        'Attackers add silent forwarding, backup 2FA, and OAuth grants that survive a password reset.',
      confidence: 'high',
      providerClass: 'the affected platform',
      mitigatesCascade: ['c-email-hub', 'c-persistence'],
    },
    {
      id: 'password-reuse',
      action:
        'Change the password on every other account that shared the compromised password, prioritising money and identity accounts.',
      urgency: 'urgent',
      priorityClass: 'cascade',
      condition: 'If that password (or a close variant) was reused anywhere else.',
      reason:
        'Credential reuse lets one leaked password unlock many accounts (credential stuffing).',
      confidence: 'high',
      providerClass: 'each affected platform',
      mitigatesCascade: ['c-reuse'],
    },
    {
      id: 'reclaim-recovery',
      action:
        'If you are locked out, use the provider’s official account-recovery flow; do not use links from any email or message you received about the breach.',
      urgency: 'urgent',
      priorityClass: 'exploitable_access',
      condition: 'If the attacker changed the password and you can no longer sign in.',
      reason:
        'Breach-notification links are a common phishing follow-up; only official recovery pages are safe.',
      confidence: 'high',
      providerClass: 'the affected platform’s official support',
    },
    {
      id: 'notify-contacts',
      action:
        'Warn contacts who may be targeted with messages sent from the account while it was compromised.',
      urgency: 'soon',
      priorityClass: 'cascade',
      condition: 'If the account can message others (email, social, chat).',
      reason:
        'A trusted account is used to phish your contacts; a heads-up blunts that second wave.',
      confidence: 'medium',
      mitigatesCascade: ['c-contacts'],
    },
    {
      id: 'preserve-evidence',
      action:
        'Screenshot unfamiliar logins, security-alert emails, and any changes the attacker made, with timestamps, before you overwrite them.',
      urgency: 'soon',
      priorityClass: 'evidence',
      condition: 'If you may report this to the platform, police, or an employer.',
      reason:
        'Login history and alert emails are the record of what happened and when; resets can clear them.',
      confidence: 'medium',
      evidence: [
        'unfamiliar login IP / device / time',
        'security alert emails',
        'attacker-made setting changes',
      ],
    },
  ],
  cascade: [
    {
      id: 'c-email-hub',
      from: 'control of your email account',
      to: 'password resets on every account registered to that email',
      mechanism: 'reset links and codes arrive in the inbox the attacker now controls',
      risk: 'high',
    },
    {
      id: 'c-reuse',
      from: 'a reused password',
      to: 'every other account using the same password',
      mechanism: 'attackers replay leaked credentials across services (credential stuffing)',
      risk: 'high',
    },
    {
      id: 'c-persistence',
      from: 'mail forwarding / recovery-setting changes',
      to: 'renewed access even after you reset the password',
      mechanism: 'silent forwarding and added recovery methods re-admit the attacker',
      risk: 'high',
    },
    {
      id: 'c-open-sessions',
      from: 'active attacker sessions',
      to: 'continued account use after a password change',
      mechanism: 'existing sessions stay valid unless explicitly revoked',
      risk: 'medium',
    },
    {
      id: 'c-contacts',
      from: 'a trusted account under attacker control',
      to: 'phishing and scams aimed at your contacts',
      mechanism: 'messages from your real account bypass your contacts’ suspicion',
      risk: 'medium',
    },
  ],
  materialUnknowns: [
    'Whether the compromised account is (or shares a password with) your email.',
    'Whether the same password was reused on other services.',
    'Whether you still have any access or are fully locked out.',
  ],
  questions: [
    'Which account was taken over, and is it your email?',
    'Was that password used anywhere else?',
    'Can you still sign in, or are you locked out?',
  ],
  limitations: [
    'No live account status was checked by this service.',
    'Recovery steps depend on the specific platform’s official process.',
  ],
  unsupportedAreas: [
    'Identifying who the attacker is.',
    'Forcing a platform to restore a permanently disabled account.',
  ],
  prohibitedClaims: [
    'guaranteed to recover',
    'we will restore your account',
    'we will identify the attacker',
    'contact this support number',
  ],
  escalationConditions: [
    'The account controls money and shows active unauthorised transactions.',
    'The compromised account is a work / admin account.',
    'The attacker is impersonating you to defraud others.',
  ],
  fallback: {
    note: 'Minimal safe set: secure email, then reset and revoke sessions on the affected account.',
    minimalActionIds: ['secure-email-first', 'reset-and-revoke'],
  },
};

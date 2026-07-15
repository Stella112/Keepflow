import type { Runbook } from './types.js';

/**
 * Runbook: stolen or lost phone.
 *
 * The value here is the cascade: a phone is not just a device, it is the
 * delivery channel for SMS OTPs, the host of your authenticator, and a bundle
 * of logged-in sessions. Ordering closes the widest-open access first.
 */
export const stolenPhone: Runbook = {
  id: 'digital-access/stolen-phone',
  version: '1.0.0',
  incidentType: 'stolen_or_lost_phone',
  title: 'Stolen or lost phone',
  matchTerms: [
    'phone',
    'stolen phone',
    'lost phone',
    'phone stolen',
    'phone got stolen',
    'lost my phone',
    'someone took my phone',
    'dropped my phone',
    'mobile',
    'smartphone',
    'iphone',
    'android',
    'device stolen',
    'pickpocket',
    'stole my phone',
    'phone was stolen',
    'phone was taken',
    'snatched my phone',
    'mobile was stolen',
    'stole my mobile',
    'lost my device',
    'lost my mobile',
  ],
  assumptions: [
    'The phone is no longer in your control and may be powered on.',
    'The phone may hold logged-in sessions, an authenticator app, and your SIM.',
    'No live device or account status has been checked by this service.',
  ],
  actions: [
    {
      id: 'safety',
      action:
        'Prioritise your physical safety — do not chase or confront whoever has the device; get to a safe place first.',
      urgency: 'immediate',
      priorityClass: 'safety',
      condition: 'If the phone was taken in a robbery, threat, or confrontation.',
      reason:
        'A replaceable device is never worth physical risk; account recovery can happen from anywhere.',
      confidence: 'high',
      providerClass: 'local police / emergency services',
    },
    {
      id: 'email-sessions',
      action:
        'From a trusted second device, change your primary email password and sign out of all its active sessions.',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition: 'If your email was logged in on the missing phone.',
      reason:
        'Email is the master reset channel — controlling it lets an attacker reset most of your other accounts.',
      confidence: 'high',
      providerClass: 'your email provider',
      mitigatesCascade: ['c-email-resets'],
    },
    {
      id: 'high-value-sessions',
      action:
        'Revoke active sessions and change passwords on money- and identity-critical accounts (exchange, bank, primary social).',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition: 'If those apps were installed and logged in on the phone.',
      reason:
        'Mobile apps typically stay authenticated, so a thief may reach these accounts without any password.',
      confidence: 'high',
      providerClass: 'the affected exchange, bank, or platform',
      mitigatesCascade: ['c-open-sessions'],
    },
    {
      id: 'remote-lock',
      action:
        'Use Find-My / device manager to remote-lock the phone and show a contact message; hold off on remote-wipe until you have secured accounts and preserved any evidence.',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition: 'If remote device management (Find My iPhone / Find My Device) was enabled.',
      reason:
        'Locking blocks further use immediately; wiping too early can destroy location evidence you may need.',
      confidence: 'medium',
      providerClass: 'your device platform (Apple / Google)',
      mitigatesCascade: ['c-open-sessions'],
    },
    {
      id: 'sim-suspend',
      action:
        'Contact your mobile carrier to suspend the SIM and place a port-out / SIM-swap freeze on the number.',
      urgency: 'urgent',
      priorityClass: 'exploitable_access',
      condition: 'Applies whenever the device (and its SIM) is missing.',
      reason:
        'Your number receives SMS OTPs; suspending it stops interception and blocks a follow-on SIM-swap.',
      confidence: 'high',
      providerClass: 'your mobile carrier',
      mitigatesCascade: ['c-sim-otp'],
    },
    {
      id: 'move-2fa',
      action:
        'Re-establish two-factor authentication on a trusted device (re-enrol your authenticator or use saved backup codes), starting with email and any exchange.',
      urgency: 'urgent',
      priorityClass: 'cascade',
      condition: 'If your authenticator app existed only on the missing phone.',
      reason:
        'Without moving 2FA you may lock yourself out while also leaving live codes on the lost device.',
      confidence: 'high',
      providerClass: 'each account provider',
      mitigatesCascade: ['c-authenticator'],
    },
    {
      id: 'preserve-evidence',
      action:
        'Record the time, place, and circumstances, keep any Find-My location history, and file a police report.',
      urgency: 'soon',
      priorityClass: 'evidence',
      condition:
        'If you may need to dispute fraudulent charges, claim insurance, or support an investigation.',
      reason:
        'A timestamped report and location trail are what insurers and banks ask for later.',
      confidence: 'medium',
      providerClass: 'local police / your insurer',
      evidence: [
        'time and location the phone went missing',
        'Find-My location history',
        'police report / reference number',
      ],
    },
    {
      id: 'audit-connected',
      action:
        'Once access is secured, audit each recovered account for unauthorised changes: recovery email/phone, forwarding rules, added devices, new API keys.',
      urgency: 'followup',
      priorityClass: 'recovery',
      condition: 'After immediate access has been secured.',
      reason:
        'Attackers plant persistence (forwarding, backup codes, linked devices) that survives a password change.',
      confidence: 'medium',
      providerClass: 'each account provider',
      mitigatesCascade: ['c-email-resets'],
    },
  ],
  cascade: [
    {
      id: 'c-sim-otp',
      from: 'possession of your SIM / phone number',
      to: 'SMS-based password resets and one-time codes',
      mechanism: 'OTPs and reset links are delivered by SMS to your number',
      risk: 'high',
    },
    {
      id: 'c-authenticator',
      from: 'an authenticator app left on the device',
      to: 'the second factor for email, exchange, and other accounts',
      mechanism: 'TOTP codes are generated on-device and may be viewable',
      risk: 'high',
    },
    {
      id: 'c-email-resets',
      from: 'an active email session',
      to: 'password resets across every connected account',
      mechanism: 'most services send reset links to the registered email',
      risk: 'high',
    },
    {
      id: 'c-open-sessions',
      from: 'logged-in banking / exchange / social apps',
      to: 'direct account access with no re-login',
      mechanism: 'mobile apps keep a long-lived authenticated session',
      risk: 'medium',
    },
  ],
  materialUnknowns: [
    'Whether the phone was locked with a strong passcode / biometrics at the moment it was lost.',
    'Whether your authenticator app was backed up or existed only on this device.',
    'Whether your number is used as the recovery method for high-value accounts.',
  ],
  questions: [
    'Was the phone locked when it went missing?',
    'Was your authenticator app stored only on that phone?',
    'Is that phone number the recovery method for your email or exchange?',
  ],
  limitations: [
    'No live account, carrier, or device status was checked by this service.',
    'Exact provider steps vary; use each provider’s official recovery channel.',
  ],
  unsupportedAreas: [
    'Physically locating or recovering the device.',
    'Insurance claim adjudication.',
  ],
  prohibitedClaims: [
    'guaranteed to recover',
    'we will locate the device',
    'we will contact your carrier for you',
    'track the thief',
  ],
  escalationConditions: [
    'The phone was taken by threat or force.',
    'You can already see unauthorised logins or transactions.',
    'Accounts controlling money or identity show new devices or changed recovery settings.',
  ],
  fallback: {
    note: 'Minimal safe set when a full plan cannot be produced: secure email, suspend the SIM.',
    minimalActionIds: ['email-sessions', 'sim-suspend'],
  },
};

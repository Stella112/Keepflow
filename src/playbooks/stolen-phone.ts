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
  version: '1.2.0',
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
      id: 'freeze-physical-cards',
      action:
        'Use any trusted device you still control to open each card issuer\'s official website by typing the known address or using a trusted bookmark, freeze every missing card, and review recent transactions. If no trusted device or web access is available, use a verified emergency number from an official statement, call from a trusted borrowed phone or landline, ask a trusted person to locate the official number without sharing credentials, or visit a branch with staff who can verify the issuer\'s process.',
      urgency: 'immediate',
      priorityClass: 'irreversible_loss',
      condition: 'If a physical wallet or any payment cards were stolen with the phone.',
      reason:
        'A stolen card can be used independently of the phone, and freezing it quickly limits further financial loss.',
      confidence: 'high',
      providerClass: 'each card issuer or bank',
      evidence: ['the last four digits of each missing card', 'unrecognised transaction details'],
    },
    {
      id: 'email-sessions',
      action:
        'If you have a trusted device, open your email provider\'s official website by typing the known address or using a trusted bookmark, change the primary email password, and sign out other active sessions. If you do not have a trusted device, use the provider\'s verified in-person or assisted-recovery route and do not enter credentials on a public or borrowed computer.',
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
        'Using official provider channels on a trusted device, revoke active sessions and change passwords on money- and identity-critical accounts (exchange, bank, primary social). Without a trusted device, contact each provider through a verified phone or staffed location to suspend access until secure recovery is possible.',
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
      id: 'prepare-for-offline',
      action:
        'While any trusted connection remains available, first secure email, freeze missing cards, revoke financial sessions, and remote-lock the phone. Then record each provider\'s verified support number or nearest branch or store and a short offline checklist without copying passwords, one-time codes, or recovery phrases. If no trusted connection exists, ask a trusted person to locate public contact details or go directly to a staffed provider location.',
      urgency: 'immediate',
      priorityClass: 'exploitable_access',
      condition: 'If you may soon lose internet or access to this trusted second device.',
      reason:
        'Securing the most exposed accounts now and keeping non-secret contact details available prevents a connection loss from stopping recovery.',
      confidence: 'high',
      providerClass: 'your email, bank, device-platform, and mobile providers',
    },
    {
      id: 'remote-lock',
      action:
        'From a trusted device, open the device platform\'s official Find-My website, remote-lock the phone, and show a safe contact message; hold off on remote-wipe until accounts are secured and useful evidence is preserved. If no trusted device is available, use the platform\'s verified assisted-recovery channel rather than signing in on a public computer.',
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
        'Use the carrier\'s official website or web chat from a trusted device to suspend the SIM and place a port-out or SIM-swap freeze on the number. If no trusted device is available or online verification requires the missing phone, call the verified support number from a trusted borrowed phone or landline, ask a trusted person to locate the official number without sharing credentials, or visit an official carrier store with any remaining identification.',
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
        'On a trusted device, use each provider\'s official account-recovery page and saved backup codes to regain access, starting with email and any exchange. If you have no trusted device, use verified assisted recovery or a staffed provider location. Re-enrol an authenticator only on a replacement trusted device; never place backup codes in a shared computer or public browser.',
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
    'Whether physical payment cards or identity documents were stolen with the phone.',
    'Whether any trusted device, borrowed phone, internet connection, trusted person, or staffed provider location is currently available.',
  ],
  questions: [
    'Was the phone locked when it went missing?',
    'Was your authenticator app stored only on that phone?',
    'Is that phone number the recovery method for your email or exchange?',
    'Were any physical payment cards or identity documents stolen too?',
    'Which safe access routes do you currently have: a trusted second device, borrowed phone, internet, trusted person, or staffed provider location?',
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

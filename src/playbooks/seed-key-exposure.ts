import type { Runbook } from './types.js';

/**
 * Runbook: possible seed phrase or private-key exposure.
 *
 * This is also the DETERMINISTIC exposure playbook returned when the security
 * layer detects secret-shaped input — in that path the model is never invoked.
 *
 * Hard truth baked into the ordering: a seed phrase cannot be "secured" once
 * exposed. It deterministically derives every key it ever will, so the only
 * real remedy is to move assets to a brand-new wallet with a new seed, from a
 * clean device. We never ask for, store, or transmit the secret itself.
 */
export const seedKeyExposure: Runbook = {
  id: 'digital-access/seed-key-exposure',
  version: '1.0.0',
  incidentType: 'seed_or_key_exposure',
  title: 'Possible seed phrase or private-key exposure',
  matchTerms: [
    'seed phrase',
    'seed',
    'recovery phrase',
    'private key',
    'privatekey',
    'mnemonic',
    'wallet phrase',
    '12 words',
    '24 words',
    'keystore',
    'metamask phrase',
    'exposed my seed',
    'leaked my private key',
    'entered my seed',
    'typed my seed',
    'gave my seed',
    'phishing seed',
  ],
  assumptions: [
    'The seed phrase or private key should be treated as fully compromised — anyone who saw it can derive every key it controls.',
    'A compromised seed cannot be re-secured; only the assets can be moved to safety.',
    'This service never sees, stores, or transmits your actual seed or key.',
  ],
  actions: [
    {
      id: 'move-to-new-wallet',
      action:
        'From a separate, clean, malware-free device, create a brand-new wallet with a newly generated seed and transfer your assets to it — most valuable and most liquid first.',
      urgency: 'immediate',
      priorityClass: 'irreversible_loss',
      condition: 'If the exposed seed or key still controls any funds or assets.',
      reason:
        'On-chain transfers are irreversible and anyone with the seed can drain it at any moment; moving assets out is the only remedy.',
      confidence: 'high',
      providerClass: 'a new self-custody wallet you control',
      mitigatesCascade: ['c-seed-derives-all', 'c-sweeper'],
    },
    {
      id: 'fund-gas-carefully',
      action:
        'Send only a small, exact amount of the native gas token to the compromised address to move assets — no more than needed per transfer.',
      urgency: 'immediate',
      priorityClass: 'irreversible_loss',
      condition: 'If the compromised wallet has no gas to pay for the rescue transfers.',
      reason:
        'A sweeper bot may auto-drain any gas you send; small exact top-ups reduce what is lost to it.',
      confidence: 'medium',
      providerClass: 'a new self-custody wallet you control',
      mitigatesCascade: ['c-sweeper'],
    },
    {
      id: 'migrate-all-derived',
      action:
        'Treat every wallet and chain derived from that same seed as compromised, and migrate each one — not just the account you were using.',
      urgency: 'urgent',
      priorityClass: 'cascade',
      condition: 'If the exposed seed backed more than one account, wallet, or chain.',
      reason:
        'One seed deterministically derives keys across many accounts and chains; all of them are exposed together.',
      confidence: 'high',
      providerClass: 'a new self-custody wallet you control',
      mitigatesCascade: ['c-seed-derives-all'],
    },
    {
      id: 'rotate-reused-key',
      action:
        'If that private key or phrase was ever reused as a password, backup, or login anywhere, change those credentials too.',
      urgency: 'urgent',
      priorityClass: 'cascade',
      condition: 'If the secret was reused outside the wallet.',
      reason:
        'Reused secrets extend the exposure beyond crypto into whatever else accepted them.',
      confidence: 'low',
      providerClass: 'each affected service',
      mitigatesCascade: ['c-reuse'],
    },
    {
      id: 'abandon-old-wallet',
      action:
        'Permanently stop using the exposed wallet and never receive funds to it again, even if it has not been drained yet.',
      urgency: 'urgent',
      priorityClass: 'exploitable_access',
      condition: 'Applies whenever a seed or key has been exposed.',
      reason:
        'The address stays controllable by whoever saw the secret; any future deposit is at risk indefinitely.',
      confidence: 'high',
      providerClass: 'a new self-custody wallet you control',
      mitigatesCascade: ['c-sweeper'],
    },
    {
      id: 'beware-recovery-scams',
      action:
        'Ignore anyone — including "wallet recovery" services or support DMs — who offers to recover your funds or asks for your seed phrase; never share it with anyone.',
      urgency: 'immediate',
      priorityClass: 'safety',
      condition: 'Applies whenever a seed or key has been exposed.',
      reason:
        'Fake recovery services are the standard second scam; no legitimate party ever needs your seed.',
      confidence: 'high',
    },
    {
      id: 'preserve-evidence',
      action:
        'Record the compromised addresses, transaction hashes, amounts, and the time and manner of exposure, in case an exchange or authority can act on stolen funds.',
      urgency: 'soon',
      priorityClass: 'evidence',
      condition: 'If funds were or may be stolen and could reach an exchange.',
      reason:
        'Exchanges and investigators can sometimes freeze funds that land on a regulated platform, but only with precise on-chain details.',
      confidence: 'low',
      providerClass: 'the receiving exchange / law enforcement',
      evidence: [
        'compromised wallet address(es)',
        'transaction hashes of any unauthorised transfers',
        'time and manner of exposure',
      ],
    },
  ],
  cascade: [
    {
      id: 'c-seed-derives-all',
      from: 'knowledge of your seed phrase',
      to: 'full control of every account and chain it derives',
      mechanism: 'the seed deterministically generates all private keys beneath it',
      risk: 'high',
    },
    {
      id: 'c-sweeper',
      from: 'a compromised address that still holds or receives funds',
      to: 'automatic draining of current and future balances',
      mechanism: 'sweeper bots watch the address and empty it as funds arrive',
      risk: 'high',
    },
    {
      id: 'c-reuse',
      from: 'a secret reused outside the wallet',
      to: 'any account that accepted the same value',
      mechanism: 'the exposed string works anywhere it was set as a credential',
      risk: 'medium',
    },
  ],
  materialUnknowns: [
    'Whether the exposed seed/key still controls any assets.',
    'How the secret was exposed (typed into a phishing site, stored on a compromised device, photographed, etc.).',
    'Whether the same seed backs other wallets or chains.',
  ],
  questions: [
    'Does the exposed wallet still hold any funds or assets?',
    'How was the seed or key exposed?',
    'Did the same seed back any other wallets or chains?',
  ],
  limitations: [
    'This service cannot reverse on-chain transactions or recover moved funds.',
    'No wallet balance or on-chain status was checked here.',
  ],
  unsupportedAreas: [
    'Recovering funds that have already left your wallet.',
    'Identifying the specific attack vector from on-chain data.',
    'Re-securing a wallet whose seed is exposed (not possible).',
  ],
  prohibitedClaims: [
    'we can recover your funds',
    'reverse the transaction',
    'secure your existing wallet',
    'send us your seed',
    'share your seed phrase',
    'guaranteed recovery',
  ],
  escalationConditions: [
    'Funds are already moving out of the wallet.',
    'The exposure came from signing a malicious approval rather than revealing the raw seed.',
    'Large or business-custody funds are involved.',
  ],
  fallback: {
    note: 'Minimal safe set: move assets to a new wallet, and never share the seed with anyone.',
    minimalActionIds: ['move-to-new-wallet', 'beware-recovery-scams'],
  },
};

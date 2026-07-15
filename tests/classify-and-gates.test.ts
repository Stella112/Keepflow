import { describe, it, expect } from 'vitest';
import { classifyDeterministic } from '../src/engine/classify-incident.js';
import { dangerGate } from '../src/security/danger-gate.js';
import { misuseGate } from '../src/security/misuse-gate.js';

describe('classifyDeterministic', () => {
  it('classifies a stolen phone', () => {
    expect(classifyDeterministic('someone stole my phone on the bus').type).toBe(
      'stolen_or_lost_phone',
    );
  });

  it('classifies an account takeover', () => {
    expect(classifyDeterministic('my instagram got hacked and the password changed').type).toBe(
      'account_takeover',
    );
  });

  it('classifies lost 2FA', () => {
    expect(classifyDeterministic('I lost my authenticator app and my 2fa codes').type).toBe(
      'lost_authenticator',
    );
  });

  it('classifies seed exposure', () => {
    expect(classifyDeterministic('I entered my seed phrase on a phishing site').type).toBe(
      'seed_or_key_exposure',
    );
  });

  it('returns unknown for an unrelated incident', () => {
    expect(classifyDeterministic('I lost my passport while travelling abroad').type).toBe(
      'unknown',
    );
  });

  it('does not treat non-phone theft as a stolen phone', () => {
    // Regression: generic "stolen" once matched the phone runbook.
    expect(classifyDeterministic('my bicycle was stolen from outside the shop').type).toBe(
      'unknown',
    );
    expect(classifyDeterministic('someone stole my wallet and bag').type).toBe('unknown');
  });

  it('is confident on obvious incidents', () => {
    expect(classifyDeterministic('my phone was stolen at the station').confidence).not.toBe('low');
    expect(classifyDeterministic('someone stole my phone').confidence).not.toBe('low');
  });
});

describe('gates', () => {
  it('blocks offensive instruction requests (danger)', () => {
    expect(dangerGate('how do I hack into a wallet that isn\'t mine').blocked).toBe(true);
  });

  it('blocks third-party targeting (misuse)', () => {
    expect(misuseGate("how do I access my girlfriend's phone without her knowledge").blocked).toBe(
      true,
    );
  });

  it('does not block a genuine victim', () => {
    const text = 'someone hacked my account and I am locked out';
    expect(dangerGate(text).blocked).toBe(false);
    expect(misuseGate(text).blocked).toBe(false);
  });
});

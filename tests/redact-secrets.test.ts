import { describe, it, expect } from 'vitest';
import {
  redactSecrets,
  containsSecretShape,
  REDACTION_PLACEHOLDER,
} from '../src/security/redact-secrets.js';

describe('redactSecrets', () => {
  it('detects a 12-word seed phrase and flags seed/key exposure', () => {
    const seed =
      'my phrase is legal winner thank year wave sausage worth useful legal winner thank yellow';
    const r = redactSecrets(seed);
    expect(r.seedOrKeyDetected).toBe(true);
    expect(r.redactionApplied).toBe(true);
    expect(r.redacted).toContain(REDACTION_PLACEHOLDER);
  });

  it('detects a seed phrase embedded in a sentence with trailing function words', () => {
    const text =
      'I typed my recovery phrase legal winner thank year wave sausage worth useful legal winner thank yellow into a popup';
    const r = redactSecrets(text);
    expect(r.seedOrKeyDetected).toBe(true);
    expect(r.redacted).not.toContain('sausage');
  });

  it('does not flag ordinary long prose as a seed phrase', () => {
    const r = redactSecrets(
      'a timestamped report and location trail are what insurers and banks ask for later on',
    );
    expect(r.seedOrKeyDetected).toBe(false);
  });

  it('detects a 64-hex private key', () => {
    const key = 'key: 0x' + 'a'.repeat(64);
    const r = redactSecrets(key);
    expect(r.seedOrKeyDetected).toBe(true);
    expect(r.findings.privateKeyHex).toBeGreaterThan(0);
  });

  it('redacts a Luhn-valid card number but does not flag seed/key', () => {
    const r = redactSecrets('my card is 4111 1111 1111 1111 and it was charged');
    expect(r.findings.cardNumber).toBe(1);
    expect(r.seedOrKeyDetected).toBe(false);
    expect(r.redacted).toContain(REDACTION_PLACEHOLDER);
  });

  it('does not redact a random non-Luhn digit run as a card', () => {
    const r = redactSecrets('order number 1234 5678 9012 3456');
    expect(r.findings.cardNumber).toBe(0);
  });

  it('redacts an OTP near 2FA vocabulary', () => {
    const r = redactSecrets('the 2fa code is 123456');
    expect(r.findings.otpCode).toBe(1);
  });

  it('redacts a password value', () => {
    const r = redactSecrets('password: hunter2xyz');
    expect(r.findings.password).toBe(1);
    expect(r.redacted).not.toContain('hunter2xyz');
  });

  it('leaves ordinary prose untouched', () => {
    const r = redactSecrets('someone stole my phone at the train station this morning');
    expect(r.redactionApplied).toBe(false);
    expect(containsSecretShape(r.redacted)).toBe(false);
  });
});

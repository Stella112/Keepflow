import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createFirstMoveRouter } from '../src/routes/firstmove.js';
import { createResultStore } from '../src/payments/result-cache.js';
import { createPaymentGate } from '../src/payments/okx-x402.js';
import type { Facilitator, PaymentRequirement, VerifyResult, SettleResult } from '../src/payments/facilitator.js';

const REQUIREMENT: PaymentRequirement = {
  scheme: 'exact',
  network: 'eip155:196',
  price: '$0.20',
  payTo: '0xSeller',
  description: 'KeepFlow — First Move',
  mimeType: 'application/json',
};

class FakeFacilitator implements Facilitator {
  verifyResult: VerifyResult = { valid: true, buyer: '0xBuyer' };
  settleResult: SettleResult = { settled: true, txHash: '0xdeadbeef' };
  verifyCalls = 0;
  settleCalls = 0;
  async verify(): Promise<VerifyResult> {
    this.verifyCalls++;
    return this.verifyResult;
  }
  async settle(): Promise<SettleResult> {
    this.settleCalls++;
    return this.settleResult;
  }
}

function buildApp(opts: { enabled: boolean; facilitator: Facilitator | null; payTo?: string }) {
  const app = express();
  app.use(express.json());
  const requirement = { ...REQUIREMENT, payTo: opts.payTo ?? REQUIREMENT.payTo };
  app.use(
    createFirstMoveRouter({
      classifier: null,
      resultStore: createResultStore(900),
      facilitator: opts.facilitator,
      paymentGate: createPaymentGate({
        enabled: opts.enabled,
        requirement,
        facilitator: opts.facilitator,
      }),
    }),
  );
  return app;
}

function xPayment(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}` };
}

const BODY = JSON.stringify({ description: 'someone stole my phone on the train' });

describe('x402 payment gate', () => {
  let fac: FakeFacilitator;
  let ctx: { server: Server; base: string };

  beforeAll(async () => {
    fac = new FakeFacilitator();
    ctx = await listen(buildApp({ enabled: true, facilitator: fac }));
  });
  afterAll(() => ctx.server.close());

  it('challenges an unpaid request with a spec-shaped 402', async () => {
    const res = await fetch(`${ctx.base}/v1/first-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: BODY,
    });
    expect(res.status).toBe(402);
    const header = res.headers.get('PAYMENT-REQUIRED');
    expect(header).toBeTruthy();
    const challenge = JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));
    expect(challenge.accepts[0].network).toBe('eip155:196');
    expect(challenge.accepts[0].payTo).toBe('0xSeller');
    expect(challenge.accepts[0].price).toBe('$0.20');
  });

  it('rejects an unparseable proof', async () => {
    const res = await fetch(`${ctx.base}/v1/first-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-PAYMENT': '!!!not-base64-or-json' },
      body: BODY,
    });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe('payment_invalid');
  });

  it('rejects a proof the facilitator says is invalid', async () => {
    fac.verifyResult = { valid: false, reason: 'insufficient funds' };
    const res = await fetch(`${ctx.base}/v1/first-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-PAYMENT': xPayment({ sig: 'x' }) },
      body: BODY,
    });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe('payment_invalid');
    fac.verifyResult = { valid: true, buyer: '0xBuyer' };
  });

  it('serves the plan on verify+settle, sets PAYMENT-RESPONSE, and does not double-charge on replay', async () => {
    const proof = xPayment({ sig: 'unique-proof-1' });
    const before = fac.settleCalls;

    const res1 = await fetch(`${ctx.base}/v1/first-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-PAYMENT': proof },
      body: BODY,
    });
    expect(res1.status).toBe(200);
    const plan = await res1.json();
    expect(plan.incident_type).toBe('stolen_or_lost_phone');
    const pr = JSON.parse(Buffer.from(res1.headers.get('PAYMENT-RESPONSE')!, 'base64').toString('utf8'));
    expect(pr.status).toBe('settled');
    expect(pr.transaction).toBe('0xdeadbeef');
    expect(fac.settleCalls).toBe(before + 1);

    // Replay the SAME payment proof — must not settle again.
    const res2 = await fetch(`${ctx.base}/v1/first-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-PAYMENT': proof },
      body: BODY,
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-Idempotent-Replay')).toBe('true');
    const pr2 = JSON.parse(Buffer.from(res2.headers.get('PAYMENT-RESPONSE')!, 'base64').toString('utf8'));
    expect(pr2.status).toBe('already_settled');
    expect(fac.settleCalls).toBe(before + 1); // unchanged — no double charge
  });
});

describe('fail-closed', () => {
  it('refuses to serve when payments are enabled but no facilitator is configured', async () => {
    const ctx = await listen(buildApp({ enabled: true, facilitator: null }));
    const res = await fetch(`${ctx.base}/v1/first-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: BODY,
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('payment_misconfigured');
    ctx.server.close();
  });

  it('passes through unpaid when payments are disabled (dev default)', async () => {
    const ctx = await listen(buildApp({ enabled: false, facilitator: null }));
    const res = await fetch(`${ctx.base}/v1/first-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: BODY,
    });
    expect(res.status).toBe(200);
    ctx.server.close();
  });
});

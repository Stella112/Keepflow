/**
 * x402 facilitator client — the seller's verify/settle counterpart.
 *
 * Follows the public x402 facilitator contract:
 *   POST {facilitatorUrl}/verify  → is the payment proof valid & authorized?
 *   POST {facilitatorUrl}/settle  → move the funds on-chain, return a tx hash.
 *
 * ⚠️ CONFIRM AGAINST OKX DOCS: the x402 spec notes facilitator response bodies
 * carry "additional fields per implementation", and OKX's facilitator base URL
 * and auth for X Layer settlement are not yet confirmed here. Field parsing
 * below is deliberately defensive (accepts common aliases), and the caller
 * FAILS CLOSED on any error — a facilitator that cannot be reached never yields
 * a free call.
 */

export interface PaymentRequirement {
  scheme: string;
  network: string; // CAIP-2, e.g. eip155:196 (X Layer)
  price: string; // "$0.20" or atomic units
  payTo: string;
  asset?: string;
  description?: string;
  mimeType?: string;
}

export interface VerifyResult {
  valid: boolean;
  buyer?: string;
  reason?: string;
}

export interface SettleResult {
  settled: boolean;
  txHash?: string;
  reason?: string;
}

export interface Facilitator {
  verify(proof: unknown, requirement: PaymentRequirement): Promise<VerifyResult>;
  settle(proof: unknown, requirement: PaymentRequirement): Promise<SettleResult>;
}

function boolField(body: Record<string, unknown>, ...keys: string[]): boolean {
  for (const k of keys) if (typeof body[k] === 'boolean') return body[k] as boolean;
  return false;
}

function strField(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) if (typeof body[k] === 'string') return body[k] as string;
  return undefined;
}

export function createHttpFacilitator(
  baseUrl: string,
  opts: { timeoutMs?: number; authHeader?: string } = {},
): Facilitator {
  const url = baseUrl.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function post(path: string, payload: unknown): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.authHeader ? { authorization: opts.authHeader } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`facilitator ${path} returned ${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(t);
    }
  }

  function requirementBody(requirement: PaymentRequirement) {
    return {
      scheme: requirement.scheme,
      network: requirement.network,
      amount: requirement.price,
      payTo: requirement.payTo,
      asset: requirement.asset,
    };
  }

  return {
    async verify(proof, requirement) {
      const body = await post('/verify', { paymentProof: proof, ...requirementBody(requirement) });
      return {
        valid: boolField(body, 'valid', 'isValid', 'authorized'),
        buyer: strField(body, 'buyer', 'payer', 'from'),
        reason: strField(body, 'reason', 'error', 'message'),
      };
    },
    async settle(proof, requirement) {
      const body = await post('/settle', { paymentProof: proof, ...requirementBody(requirement) });
      return {
        settled: boolField(body, 'settled', 'success'),
        txHash: strField(body, 'txHash', 'transaction', 'tx_hash', 'transactionHash'),
        reason: strField(body, 'reason', 'error', 'message'),
      };
    },
  };
}

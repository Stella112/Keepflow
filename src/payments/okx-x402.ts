import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config.js';
import type { Facilitator, PaymentRequirement } from './facilitator.js';

/**
 * OKX x402 payment gate (seller side).
 *
 * Emits a spec-shaped 402 challenge (base64 `PAYMENT-REQUIRED` header carrying
 * `accepts[]`) to unpaid callers, and verifies a presented `X-PAYMENT` proof
 * with the facilitator before letting the request through. Settlement happens
 * AFTER the resource is produced (see the route), so a caller is only charged
 * on a successful response.
 *
 * FAILS CLOSED: when payments are enabled but no facilitator is configured, the
 * gate refuses to serve rather than give the call away for free.
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** Stable id for a verified payment; used as the idempotency key. */
    paymentId?: string;
    x402?: {
      proof: unknown;
      requirement: PaymentRequirement;
      buyer?: string;
    };
  }
}

export function buildRequirement(config: Config): PaymentRequirement {
  return {
    scheme: 'exact',
    network: config.payments.network,
    price: config.payments.priceUsd,
    payTo: config.payments.payToAddress ?? '',
    asset: config.payments.asset,
    description: `${config.service.asp} — ${config.service.name}`,
    mimeType: 'application/json',
  };
}

function encodeChallenge(requirement: PaymentRequirement): string {
  const challenge = {
    x402Version: 2,
    accepts: [
      {
        scheme: requirement.scheme,
        network: requirement.network,
        price: requirement.price,
        payTo: requirement.payTo,
        ...(requirement.asset ? { asset: requirement.asset } : {}),
        description: requirement.description,
        mimeType: requirement.mimeType,
      },
    ],
  };
  return Buffer.from(JSON.stringify(challenge), 'utf8').toString('base64');
}

/** Decode an X-PAYMENT header value: base64(JSON) preferred, raw JSON accepted. */
function decodeProof(headerValue: string): unknown | null {
  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8');
    const asJson = tryParse(decoded);
    if (asJson !== null) return asJson;
  } catch {
    /* fall through */
  }
  return tryParse(headerValue);
}

export interface PaymentGateOptions {
  enabled: boolean;
  requirement: PaymentRequirement;
  facilitator: Facilitator | null;
}

export function createPaymentGate(opts: PaymentGateOptions) {
  const { enabled, requirement, facilitator } = opts;

  return async function paymentGate(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!enabled) {
      next(); // dev / unpaid-access-by-design
      return;
    }

    // Fail closed: enabled but unconfigured must never serve a free call.
    if (!facilitator || !requirement.payTo) {
      res.status(500).json({ error: 'payment_misconfigured' });
      return;
    }

    const headerValue = req.header('X-PAYMENT') ?? req.header('PAYMENT-SIGNATURE');
    if (!headerValue) {
      res
        .status(402)
        .set('PAYMENT-REQUIRED', encodeChallenge(requirement))
        .json({ error: 'payment_required', accepts: [requirement] });
      return;
    }

    const proof = decodeProof(headerValue);
    if (proof === null) {
      res
        .status(402)
        .set('PAYMENT-REQUIRED', encodeChallenge(requirement))
        .json({ error: 'payment_invalid', reason: 'unparseable X-PAYMENT proof' });
      return;
    }

    let verified;
    try {
      verified = await facilitator.verify(proof, requirement);
    } catch (err) {
      // Fail closed on facilitator error.
      res.status(402).json({
        error: 'payment_unverifiable',
        reason: err instanceof Error ? err.message : 'facilitator error',
      });
      return;
    }

    if (!verified.valid) {
      res
        .status(402)
        .set('PAYMENT-REQUIRED', encodeChallenge(requirement))
        .json({ error: 'payment_invalid', reason: verified.reason ?? 'proof rejected' });
      return;
    }

    req.x402 = { proof, requirement, buyer: verified.buyer };
    req.paymentId = createHash('sha256').update(headerValue).digest('hex');
    next();
  };
}

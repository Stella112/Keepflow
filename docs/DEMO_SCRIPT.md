# KeepFlow 90-second demo

## Story

A solo traveller in Paris has had their phone and wallet stolen. They have no
other device, no borrowed phone, no internet, no cash, and no identification.
They can reach one trusted person, but transport availability is unknown.

## Recording sequence

**0:00-0:10 — The problem**

Show the KeepFlow landing page and say: "When life is disrupted, generic advice
often assumes you still have the phone, money, or internet you just lost."

**0:10-0:24 — One paid request**

Show `POST /v1/continuity-pack` with the traveller's location and all eight
access states. Briefly show the OKX x402 challenge at `0.05 USDT`, then the paid
response. Never expose a signature, API credential, wallet secret, or personal
contact detail in the recording.

**0:24-0:48 — Access-aware execution**

Show the first safe move and the three time windows. Highlight that a step which
would normally require a phone, internet, money, ID, or transport includes a
staffed, borrowed-device, trusted-person, or in-person alternative. Show the
completion evidence so the viewer sees how KeepFlow distinguishes advice from a
finished task.

**0:48-1:03 — Messages and delegation**

Show the ready-to-send bank/carrier/family/embassy scripts, then one delegation
card with its `share_only`, `never_share`, and completion-proof boundaries.

**1:03-1:18 — Usable artifacts**

Open the printable PDF and DOCX continuity brief. Import the ICS file into a
calendar and show its review checkpoints. State clearly that KeepFlow does not
send the messages or store the reminders.

**1:18-1:30 — Product proof**

Show `/health` (`service_count: 4`, `paid_capability_count: 8`) and `/metrics`
with aggregate request/artifact counters only. Close with: "KeepFlow doesn't
just tell you what to do. It turns disruption into a safe continuity pack you
can follow, share, and schedule."

## Pre-recording checks

- Use a fictional scenario with no personal data.
- Confirm every access state is present.
- Confirm the public 402 advertises exactly `0.05 USDT` on X Layer.
- Confirm the response includes PDF, DOCX, and ICS with verified hashes.
- Open every generated artifact before recording.
- Keep the full video under 90 seconds.

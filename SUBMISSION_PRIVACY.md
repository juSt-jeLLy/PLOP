# How PLOP Fits the Privacy Track

PLOP is a privacy‑first OTC trading system designed to prevent on‑chain order leakage and identity exposure.

## Privacy guarantees

- **Encrypted orders:** Order payloads are encrypted client‑side and stored off‑chain (Fileverse), so order size, price, and intent never appear on‑chain.
- **Hidden settlement recipients:** Settlement details are stored as **encrypted ENS text records**, so the recipient address is not public.
- **No public deposit addresses:** Deposit addresses are returned only via the engine API and embedded in encrypted orders, keeping the funding path private.
- **Rotating session identities:** Each trading session uses a randomized ENS subname, decoupling user identity from order flow.
- **Policy‑gated settlement:** BitGo policies + the auto‑approver ensure funds only move to the intended recipient without revealing who that is publicly.

In short, PLOP makes **private, non‑custodial settlement** possible while still preserving safety controls — exactly the kind of infrastructure that strengthens privacy for Ethereum applications.

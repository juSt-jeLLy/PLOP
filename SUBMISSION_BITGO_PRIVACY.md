# Best Privacy Application Using BitGo

PLOP is a **privacy‑preserving OTC exchange** built directly on BitGo’s MPC wallets and policy system. Orders are encrypted client‑side and stored off‑chain; the only on‑chain actions are deposits and settlement transfers from BitGo, which means **order intent, size, and counterparty are never public**.

## Why this fits the BitGo privacy track

- **Fresh deposit addresses per order** from BitGo reduce linkability and prevent simple address‑based tracking.
- **Policy‑gated settlement** ensures funds only move to authorized recipients (whitelist + velocity rules).
- **Webhook + auto‑approver flow** validates each pending approval against encrypted order data before releasing funds.
- **No public settlement recipients**: recipients are encrypted and only decrypted inside the engine at match time.

In short, PLOP uses BitGo’s wallet infrastructure to deliver **private, policy‑controlled settlement** — exactly the kind of privacy‑first application this track calls for.

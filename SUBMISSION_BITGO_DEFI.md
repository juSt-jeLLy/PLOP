# Best DeFi Application Using BitGo

PLOP is a DeFi OTC exchange that uses **BitGo MPC wallets** as the settlement layer, bringing institutional‑grade security and controls to on‑chain trading.

## Why this fits the BitGo DeFi track

- **MPC wallet settlement:** all trades settle from a BitGo MPC hot wallet on Hoodi.
- **Policy enforcement:** whitelist + velocity limit policies gate every transfer, so settlement is controlled and auditable.
- **Approval workflows:** pending approvals are validated and auto‑approved only when they match the encrypted order payload.
- **Real‑time automation:** BitGo webhooks + engine watchers coordinate deposits, live order activation, and settlement.

This is a composable DeFi primitive (private OTC swap) that directly leverages BitGo’s SDK, policies, and webhooks for secure, automated settlement.

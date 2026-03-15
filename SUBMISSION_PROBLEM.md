# The Problem It Solves

On‑chain trading leaks intent. Large or institutional orders are visible to the public mempool and orderbooks, which invites front‑running, market impact, and unwanted surveillance. At the same time, most privacy systems sacrifice controls, auditability, or operational safety.

**PLOP solves this by making OTC trading private _and_ policy‑governed.**

## What people can use it for

- **Private OTC swaps** without exposing size, price, or counterparties.
- **Institutional or treasury trades** where market impact and leakage are unacceptable.
- **High‑trust settlement flows** with MPC controls, whitelists, velocity limits, and approvals.

## Why it’s safer

- **Orders are encrypted client‑side** and stored off‑chain (Fileverse); nothing sensitive is public.
- **Settlement recipients are encrypted in ENS**, so the settlement address is never public.
- **BitGo policies protect funds**, and optional auto‑approver logic enforces that only the intended recipients get paid.
- **Per‑order BitGo deposit addresses** reduce linkability and improve privacy.

In short: PLOP gives you **dark‑pool style privacy** with **enterprise‑grade safety controls**, without needing custom L2s or trusting a centralized exchange.

# How PLOP Fits the ENS Creativity Track

PLOP treats ENS as a **programmable coordination layer** rather than a simple name → address registry. Each trading session gets a randomized subname (e.g. `a1b2c3.plop.eth`), and the resolver stores **encrypted settlement instructions** in ENS text records. The key record is:

- `plop.settlement` (ciphertext envelope only the engine can decrypt)

Additional text records encode session state and post‑trade receipts:

- `plop.active`
- `plop.pairs`
- `plop.receipts`

This means the engine can coordinate settlement without ever publishing recipient addresses or order details on‑chain.

This is a creative DeFi use of ENS because the **text records become the privacy‑preserving control plane** for a dark‑pool‑style exchange. The ENS name is used for identity and session state, while sensitive data lives only in encrypted form. That goes beyond common ENS patterns (address resolution, content hash, or simple metadata) and turns ENS into a secure signaling layer for off‑chain order flow and on‑chain settlement.

In short, PLOP shows ENS can be **more than a naming system** — it can be the glue that binds privacy, authorization, and settlement into a coherent DeFi workflow.

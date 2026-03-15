# Challenges I Ran Into (and How I Solved Them)

## ENS ↔ BitGo compatibility gap (two chains, one flow)
**Challenge:** ENS writes live on Sepolia, but settlement funds live on Hoodi via BitGo MPC. I had to make sure the identity layer (ENS) and the settlement layer (BitGo) never drifted or leaked data across chains.  
**Solution:** ENS is used only for encrypted session metadata (`plop.settlement`, `plop.active`, `plop.receipts`). The deposit address stays **off‑chain** and is only returned via the engine API and embedded in the encrypted order payload. That kept ENS clean and ensured all real value movement happens on Hoodi.

## BitGo policy rules vs. dynamic settlement
**Challenge:** BitGo’s policy system is strict, and the SDK behavior didn’t match expectations. Creating new whitelist rules per match isn’t allowed, and `updatePolicyRule` behaved inconsistently in the context of my wallet setup.  
**Solution:** I switched to updating the **existing** whitelist rule (never creating new ones), and I keyed all settlement sends to that rule update step. This guarantees only the intended recipient can be paid — and still keeps policies enforceable.

## Approvals: “who verifies settlement is correct?”
**Challenge:** Even with policies, I needed a privacy‑preserving way to enforce that **only the intended recipient + amount** could be approved. That’s hard when the orders are encrypted and stored off‑chain.  
**Solution:** I built an **auto‑approver** that decrypts the order payload (engine secret key), validates the exact recipient + amount, and approves the BitGo pending approval only if it matches. If it doesn’t match, it rejects or skips. This created a cryptographic “policy gate” without exposing recipient data publicly.

## Privacy constraints vs. usability
**Challenge:** Keeping privacy strong (encrypted orders, no public deposit addresses) makes UX harder — history disappeared after session rotation, and users couldn’t see past trades.  
**Solution:** I kept session privacy intact, but added **local history aggregation** on the frontend (stores past subnames in localStorage and queries each). That gives a user‑friendly history without leaking anything on‑chain.
\---

These issues came directly from bridging **ENS identity**, **BitGo MPC policies**, and **private off‑chain order storage** into one coherent flow. Each fix was necessary to keep the system both private **and** safe enough for real settlement. 

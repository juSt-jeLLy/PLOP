# PLOP — Rotating Dark Pool
Privacy-preserving institutional OTC
"large orders shouldn't move the market"
Three sponsor primitives, one novel stack:
* ENS auto-rotating addresses → Ethereum Sepolia
* Fileverse encrypted order matching → REST API (chain-agnostic storage)
* BitGo OTC settlement + policy → Hoodi (hteth testnet coin)
The gap nobody has filled: ENS's own docs mention "auto-rotating addresses on each name resolution for privacy" — nobody has BUILT this. PLOP builds it, with institutional settlement on Hoodi.

## What It Does
Institutions need to execute large trades without telegraphing their position to the market. PLOP builds a dark pool where:
* Every participant's ENS name resolves to a fresh address on each lookup (auto-rotating)
* Orders are submitted as encrypted Fileverse documents — nobody sees counterparty until match
* When a match is found, a BitGo MPC wallet handles settlement between both parties with policy rules preventing front-running
* **Partial fills supported** — a 100 ETH order can match against multiple smaller orders; the unfilled remainder re-enters the book automatically as a residual order
* The "order book" is a set of encrypted Fileverse ddocs, each identified by a `ddocId`
* Matching is done off-chain, settlement on-chain through BitGo on Hoodi
* No public mempool leakage

The novel mechanic: ENS auto-rotation is the privacy primitive — literally mentioned in ENS's prize brief as something they want to see built. Fileverse is the encrypted order book. BitGo is the settlement layer institutions already trust. This is the only idea that hits ENS's most specific prize hint verbatim.

## Chain Architecture — Confirmed Against Real Docs
Ethereum Sepolia (chain ID 11155111)
  ├── ENS Registry         → 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  ├── ENS Public Resolver  → 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5
  ├── ENS NameWrapper      → 0x0635513f179D50A207757E05759CbD106d7dFcE8
  ├── DarkPoolResolver.sol → deployed by you (custom wildcard resolver)
  └── Fileverse on-chain sync → content hashes committed on-chain via Fileverse server

Hoodi (chain ID 560048)
  └── BitGo MPC wallet     → hteth coin on app.bitgo-test.com
      ├── wallet.createAddress() → deposit addresses per session
      ├── sendMany()             → atomic ETH settlement (ETH-only pairs)
      ├── send() × 2            → two sequential sends per ERC-20 settlement
      └── policy engine         → whitelist + velocity + webhook

Off-chain REST API (chain-agnostic)
  └── Fileverse order ddocs → encrypted, accessed via fetch() REST calls
                               ddocId is the document reference
                               native listDocs() pagination — no local index file

**Fileverse is a REST API — not the @fileverse/agents npm SDK.**
Do not install `@fileverse/agents`. Do not use Pimlico, Pinata, or any wallet private key for Fileverse. All calls use plain `fetch()` with `FILEVERSE_API_KEY` and `FILEVERSE_SERVER_URL`. The API has native `GET /api/ddocs` pagination so no local `data/active-orders.json` index is needed.

Why cross-chain (ENS on Sepolia, funds on Hoodi):
* ENS only exists on Ethereum (Mainnet/Sepolia) — the registry is Ethereum-native
* Fileverse is accessed via REST API — it is chain-agnostic from the engine's perspective
* BitGo testnet ETH now maps to **Hoodi** under the `hteth` coin code
* ENS identity stays on Sepolia while settlement happens on Hoodi

> **⚠️ ERC-20 settlement uses two sequential sends, not sendMany.**
> BitGo's `sendMany()` only supports native ETH recipients. For any token pair involving ERC-20s (USDC, WBTC, etc.), settlement uses two sequential `send()` calls — one to the buyer, one to the seller. This means settlement is **not atomic** for ERC-20 pairs: if the second send fails after the first succeeds, manual intervention is required. For the hackathon demo this is acceptable. Atomic ERC-20 settlement (via an escrow contract) is a roadmap item. See the BitGo section for the exact implementation.

## ENS — Deep Technical Breakdown
✅ Custom resolver — the core mechanic (REAL, buildable)

ENSIP-10 lets you write a fully custom resolver contract. Instead of returning a stored address, your resolver can compute a fresh address on every call — derived from the caller's identity, a nonce, or a timestamp. This IS the auto-rotation mechanism. Nobody has shipped this for a dark pool.

```solidity
// DarkPoolResolver.sol — deployed on Ethereum Sepolia
function addr(bytes32 node) external view returns (address payable) {
  uint256 nonce = rotationNonces[node];
  uint256 epoch = block.timestamp / EPOCH_SECONDS;
  return payable(deriveAddress(node, nonce, epoch));
}

function deriveAddress(bytes32 node, uint256 nonce, uint256 epoch)
  internal pure returns (address) {
  return address(uint160(uint256(
    keccak256(abi.encodePacked(node, nonce, epoch))
  )));
}

function rotateAddress(bytes32 node) external onlyEngine {
  rotationNonces[node]++;
  emit AddressRotated(node, rotationNonces[node]);
}
```

✅ ENSIP-10 Wildcard resolution (REAL)

One resolver contract on Sepolia handles every *.plop.eth subname that will ever exist. Critical: frontend must use wagmi/viem's `getEnsAddress()` — not raw `addr()` calls — which handles ENSIP-10 automatically.

✅ Text records for order metadata (REAL)

```
plop.pairs   = "ETH/USDC,WBTC/USDC"
plop.active  = "true"
plop.receipts = "ddocId1,ddocId2"  // comma-separated Fileverse ddocIds
```

## Fileverse — Deep Technical Breakdown
✅ FULLY POSSIBLE — REST API, chain-agnostic

Fileverse is integrated via its REST API, not the `@fileverse/agents` npm package. Setup takes ~5 minutes via `ddocs.new`.

```javascript
// All Fileverse calls — plain fetch, no SDK
const res = await fetch(`${SERVER_URL}/api/ddocs?apiKey=${API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'order', content: encryptedPayload }),
});
const { data } = await res.json();
const ddocId = data.ddocId; // reference for all future read/update/delete
```

What Fileverse handles in PLOP:
* Encrypted order submission — each order is a Fileverse ddoc, encrypted with NaCl box before upload. `ddocId` is the document reference used throughout the engine.
* Off-chain order book — the matching engine paginates `GET /api/ddocs` to enumerate all live orders. No local index file needed.
* Partial fill tracking — each ddoc stores `filledAmount` alongside `originalAmount`; when a partial match settles, the ddoc is updated and a new residual ddoc is created for the remainder.
* Settlement receipts — encrypted receipt written to both parties after settlement confirms; receipts reference the original order `ddocId`.

**Document lifecycle:** Every `createDoc()` or `updateDoc()` starts with `syncStatus: 'pending'`. Call `waitForSync(ddocId)` and poll until `syncStatus === 'synced'` (~5–30s) before the permanent on-chain link is valid.

**Native list:** `GET /api/ddocs?limit=50&skip=0` returns `{ ddocs, total, hasNext }` — paginate to rebuild the full order book on engine startup. No `data/active-orders.json` cache needed.

> **⚠️ Only one active API key at a time.** Rotating it immediately invalidates the old key — all engine processes using the old key will fail.

## BitGo — Deep Technical Breakdown
✅ FULLY POSSIBLE on Hoodi (hteth)

BitGo testnet ETH uses the `hteth` coin code and runs on **Hoodi**. Self-custody MPC hot wallets work on testnet. The policy engine enforces whitelisted addresses only — the anti-front-running control. Webhooks fire when settlement confirms on Hoodi.

MPC key structure: You hold user key + backup key. BitGo holds key 3 and co-signs. BitGo's co-sign is gated by your policy rules — if a policy rule blocks the transaction, BitGo refuses to co-sign and the send fails.

> **⚠️ ERC-20 pairs use two sequential sends — not sendMany.**
> `sendMany()` supports multiple recipients for native ETH only. For ERC-20 token legs, each recipient requires a separate `send()` call — not atomic. If send #2 fails after send #1 confirms, halt and require manual resolution. Do NOT retry automatically — double-spend risk.

> **⚠️ Whitelist via `updatePolicyRule`, not `createPolicyRule`.**
> One whitelist rule is created in `setupBitgo.ts` (stored as `WHITELIST_POLICY_ID`). JIT whitelisting at match time means calling `updatePolicyRule()` to append both session addresses to the existing rule — never creating a new rule per settlement. The whitelist rule must have no `approvers` so updates auto-activate within seconds.

> **⚠️ Import Hteth, not Teth, for hot wallet sends.**
> Use `import { Hteth } from '@bitgo/sdk-coin-eth'` in any file that calls `send()` or `sendMany()`. `Teth` is for read operations and wallet creation only.

> **ℹ️ BitGo 48-hour whitelist lock-in — not a hackathon blocker.**
> Note in README as expected production behaviour.

## Full Flow — Step by Step

**Step 1 — Anonymous session identity (ENS on Ethereum Sepolia)**

Trader connects wallet. Your app generates a throwaway subname — x7k2m.plop.eth — resolved by your custom wildcard DarkPoolResolver.sol on Ethereum Sepolia. The resolver computes a fresh derived address from keccak256(node, nonce, epoch). ENS text record stores: accepted pairs, active status, receipts, and encrypted settlement authorization (not the deposit address).

**Step 2 — Encrypted order submission (Fileverse REST API)**

Trader fills order: sell token, buy token, amount, minimum acceptable price, TTL. Frontend encrypts this JSON client-side using NaCl box — only the matching engine can decrypt. The encrypted payload is stored as a Fileverse ddoc via `POST /api/ddocs`. After `waitForSync()`, the content hash is committed on-chain. The `ddocId` is the order's permanent reference. No local index file — the engine paginates `GET /api/ddocs` to enumerate orders.

**Step 3 — Collateral deposit into BitGo MPC wallet (BitGo on Hoodi)**

Trader deposits the exact sell amount into a BitGo self-custody MPC hot wallet address on Hoodi. This address was generated via `wallet.createAddress()` and returned by the engine API; it is embedded in the encrypted order payload, not stored in ENS. BitGo fires a webhook when the deposit confirms. Only then does the order status update to LIVE in Fileverse.

**Step 4 — Off-chain matching (Node.js Engine)**

Polling loop every 15 seconds: `GET /api/ddocs` (paginated) to fetch all ddocs, filter for status LIVE, decrypt each with engine secret key. Matching logic: inverse token pairs + price overlap + TTL not elapsed. Fill amount = min(remainingA, remainingB). Partial fills supported.

**Step 5 — Settlement via BitGo (BitGo on Hoodi)**

Engine calls `applyPartialFill()` first (updates Fileverse, creates residual ddocs). Then `updatePolicyRule()` to JIT-whitelist both session addresses. Then `sendMany()` for ETH-only pairs (atomic) or two sequential `send()` calls for ERC-20 pairs (not atomic).

For **ERC-20 pairs**: if send #2 fails after send #1 confirms — halt, mark PARTIAL_SETTLEMENT in Fileverse, alert, do not retry. Do not attempt to reverse.

**Step 6 — Address rotation post-settlement (ENS on Ethereum Sepolia)**

BitGo webhook fires on all sends confirmed. Engine calls `rotateAddress(node)` on DarkPoolResolver for **fully-filled** parties only — increments nonce, changes derived address.

**For partial fills:** partially-filled party does NOT rotate — their residual ddoc is LIVE under the same session address. Rotation happens only when `remainingAmount === 0` or TTL expires.

**Step 7 — Settlement receipt written to Fileverse**

Encrypted receipt ddoc created for each party via `POST /api/ddocs`: tx hashes, matched price, fill amounts, counterparty session ENS name (not real wallet). For partial fills: includes `originalAmount`, `filledAmount`, `remainingAmount`, `parentDdocId`. The receipt `ddocId` is appended to the `plop.receipts` ENS text record. `waitForSync()` called before updating ENS.

## Reference Links

### 🟦 ENS (all on Ethereum Sepolia)

| Link | Purpose |
|------|---------|
| https://docs.ens.domains/web/quickstart/ | Starting point — resolve names, read records |
| https://docs.ens.domains/ensip/10/ | ENSIP-10 spec — wildcard resolution, resolve() function, interface ID 0x9061b923 |
| https://docs.ens.domains/resolvers/writing/ | Write a custom resolver — addr(), resolve(), supportsInterface() |
| https://docs.ens.domains/web/records | Text record API — plop.pairs, plop.active, plop.receipts, plop.settlement |
| https://docs.ens.domains/web/resolution/ | Resolution call chain — name → resolver → address |
| https://docs.ens.domains/web/subdomains | Wildcard resolvers — unlimited subnames without registering each |
| https://docs.ens.domains/learn/deployments | All Sepolia contract addresses |
| https://sepolia.app.ens.domains | Register plop.eth and point at DarkPoolResolver |
| https://wagmi.sh/react/api/hooks/useEnsAddress | Frontend hook — ENSIP-10 wildcard correct |

### 🟣 Fileverse (REST API — chain-agnostic)

| Link | Purpose |
|------|---------|
| https://docs.fileverse.io/0x2d133a10443a13957278e7dfeefbfee826c82fd8/117 | Full REST API guide — setup, create/read/update/list/delete/search ddocs |
| https://ddocs.new | Web UI — manage documents, check sync status, verify on-chain links |

### 🟢 BitGo (Hoodi — hteth coin, app.bitgo-test.com)

| Link | Purpose |
|------|---------|
| https://developers.bitgo.com/docs/get-started-sdk-install | Install + auth for testnet |
| https://developers.bitgo.com/docs/wallets-create-mpc-keys | Create MPC key set — use this, NOT generateWallet() |
| https://developers.bitgo.com/docs/wallets-create-wallets | Create wallet with wallets().add() for hteth |
| https://developers.bitgo.com/docs/wallets-create-addresses | wallet.createAddress() — fresh deposit address per session |
| https://developers.bitgo.com/docs/policies-create | Create the 3 policy rules |
| https://developers.bitgo.com/docs/wallets-whitelists-update | updatePolicyRule() — JIT whitelist at match time |
| https://developers.bitgo.com/docs/webhooks-wallet | Wallet webhooks — deposit confirm + settlement confirm |
| https://developers.bitgo.com/docs/withdraw-wallet-type-self-custody-mpc-hot-simple | send() and sendMany() — import Hteth (not Teth) |
| https://app.bitgo-test.com | Testnet dashboard |

### 📦 Supporting Libraries

| Link | Purpose |
|------|---------|
| https://www.npmjs.com/package/tweetnacl | NaCl box — client-side order encryption |
| https://docs.ens.domains/web/libraries | ENS-compatible libs — use viem/wagmi for ENSIP-10 |

### The 5 Tabs Open During the Build

| Link | When you need it |
|------|-----------------|
| docs.ens.domains/resolvers/writing/ | Writing DarkPoolResolver.sol |
| docs.ens.domains/ensip/10/ | Implementing resolve() for wildcard subnames |
| docs.fileverse.io/.../117 | Every Fileverse REST call — createDoc, listDocs, updateDoc |
| developers.bitgo.com/docs/wallets-create-mpc-keys | Setting up the hteth MPC wallet |
| developers.bitgo.com/docs/wallets-whitelists-update | JIT whitelist updates at settlement time |

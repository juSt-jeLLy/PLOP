# PLOP — Build Rules for Codex / Claude Code
### Feed this file at the start of every session

---

## Project Overview

PLOP (Privacy Layer for OTC Protocol) is a privacy-preserving institutional OTC trading platform. Three sponsor SDKs integrated: ENS (identity + rotation), Fileverse (encrypted order book via REST API), BitGo (MPC settlement). Frontend is built separately in Lovable — this codebase is **backend + smart contracts only**.

---

## Chain Configuration — Hardcoded, Non-Negotiable

```
Ethereum Sepolia (chain ID 11155111)
  ├── ENS Registry          → 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
  ├── ENS NameWrapper       → 0x0635513f179D50A207757E05759CbD106d7dFcE8
  ├── ENS Public Resolver   → 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5
  ├── ENS Universal Resolver→ 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe
  └── DarkPoolResolver.sol  → deployed by you (custom wildcard resolver)

Ethereum Sepolia (chain ID 11155111)
  └── BitGo MPC wallet      → coin: 'teth', env: 'test', app.bitgo-test.com

Fileverse (off-chain REST API — chain-agnostic)
  └── Order ddocs           → REST API against your deployed Fileverse server
                              Documents stored as ddocs, retrieved by ddocId
                              Blockchain sync handled server-side
                              Native listDocs() pagination — no local index file
```

**Why one chain for ENS + BitGo:**
- ENS only exists on Ethereum — the registry is Ethereum-native, non-negotiable
- BitGo supports `teth` (Ethereum Sepolia) as a first-class coin
- Fileverse is accessed via REST API — it is chain-agnostic from the engine's perspective

**Never use:**
- `@fileverse/agents` npm SDK — the hackathon API is REST, not the agents SDK
- `chain: 'sepolia'` / `chain: 'gnosis'` constructor options for Fileverse — irrelevant, REST API is chain-agnostic
- Pimlico, Pinata, or any wallet private key for Fileverse — the server handles all of this
- `data/active-orders.json` local index — the Fileverse REST API has native `listDocs()` pagination
- Any mainnet chain — hackathon is testnet only

---

## Repository Structure

```
plop/
├── contracts/
│   ├── DarkPoolResolver.sol      # ENS wildcard resolver — Ethereum Sepolia
│   └── interfaces/
│       └── IExtendedResolver.sol # ENSIP-10 interface (0x9061b923)
│
├── engine/
│   ├── index.ts                  # Entry point — starts polling + webhook server
│   ├── session.ts                # ENS session creation + rotation
│   ├── orders.ts                 # Fileverse REST calls: createDoc/getDoc/updateDoc/listDocs
│   ├── matcher.ts                # Off-chain matching logic
│   ├── settlement.ts             # BitGo send/sendMany + policy whitelist update
│   ├── webhooks.ts               # Express server — BitGo webhook handler
│   └── receipts.ts               # Post-settlement Fileverse receipt writer
│
├── scripts/
│   ├── deployResolver.ts         # Deploy DarkPoolResolver.sol to Ethereum Sepolia
│   └── setupBitgo.ts             # Create teth wallet + 3 policy rules on Ethereum Sepolia
│                                 # No setupFileverse.ts — Fileverse setup done via ddocs.new UI
│
├── test/
│   ├── resolver.test.ts
│   ├── matcher.test.ts
│   └── settlement.test.ts
│
├── types/
│   └── index.ts                  # All shared TypeScript types — no inline types anywhere
│
├── .env.example
├── RULES.md
└── package.json
```

---

## Environment Variables

```bash
# Ethereum Sepolia — ENS
ETH_SEPOLIA_RPC=https://sepolia.infura.io/v3/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...              # engine's signing wallet on Sepolia

# Fileverse REST API — get both from ddocs.new after deploying your server
FILEVERSE_API_KEY=...                  # from Settings → Developer Mode → Your API Keys
FILEVERSE_SERVER_URL=https://...       # your deployed Fileverse server URL (from ddocs.new deploy)

# Ethereum Sepolia — BitGo
BITGO_ENV=test                         # always 'test' for hackathon
BITGO_ACCESS_TOKEN=...                 # from app.bitgo-test.com
BITGO_WALLET_ID=...
BITGO_WALLET_PASSPHRASE=...
BITGO_WEBHOOK_SECRET=...               # for webhook signature verification

# Engine
ENGINE_PORT=3001
ENGINE_POLL_INTERVAL_MS=15000          # poll Fileverse every 15s
EPOCH_SECONDS=3600                     # ENS rotation window (1 hour)

# Populated after deployment — run scripts first
DARK_POOL_RESOLVER_ADDRESS=0x...       # DarkPoolResolver on Ethereum Sepolia
WHITELIST_POLICY_ID=...                # BitGo policy ID for destination whitelist (UPDATE this at match time — never create new)
VELOCITY_POLICY_ID=...                 # BitGo policy ID for velocity limit
AUDIT_WEBHOOK_POLICY_ID=...            # BitGo policy ID for audit webhook
```

---

## Smart Contract Rules — `DarkPoolResolver.sol`

### Deploy ONLY to Ethereum Sepolia
Never deploy to Gnosis or any other chain. Everything is on Ethereum Sepolia. The ENS registry on Sepolia is what this contract registers with.

### Must implement ENSIP-10 exactly
```solidity
bytes4 constant EXTENDED_RESOLVER_INTERFACE_ID = 0x9061b923;

function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == EXTENDED_RESOLVER_INTERFACE_ID   // ENSIP-10 wildcard
        || interfaceId == 0x3b3b57de                       // addr(bytes32)
        || interfaceId == 0x59d1d43c;                      // text(bytes32,string)
}
```

### resolve() is REQUIRED — not optional
```solidity
function resolve(bytes calldata name, bytes calldata data)
    external view returns (bytes memory) {
    bytes4 selector = bytes4(data[:4]);
    if (selector == IAddrResolver.addr.selector) {
        bytes32 node = abi.decode(data[4:], (bytes32));
        return abi.encode(addr(node));
    }
    if (selector == ITextResolver.text.selector) {
        (bytes32 node, string memory key) = abi.decode(data[4:], (bytes32, string));
        return abi.encode(text(node, key));
    }
    revert("unsupported selector");
}

function addr(bytes32 node) public view returns (address payable) {
    uint256 nonce = rotationNonces[node];
    uint256 epoch = block.timestamp / EPOCH_SECONDS;
    return payable(deriveAddress(node, nonce, epoch));
}
```

### Address derivation — deterministic, reproducible
```solidity
uint256 public constant EPOCH_SECONDS = 3600;

function deriveAddress(bytes32 node, uint256 nonce, uint256 epoch)
    internal pure returns (address) {
    return address(uint160(uint256(
        keccak256(abi.encodePacked(node, nonce, epoch))
    )));
}
```

### Access control — only engine can rotate
```solidity
address public engine;

constructor(address _engine) {
    engine = _engine;
}

modifier onlyEngine() {
    require(msg.sender == engine, "DarkPoolResolver: not engine");
    _;
}

function rotateAddress(bytes32 node) external onlyEngine {
    rotationNonces[node]++;
    emit AddressRotated(node, rotationNonces[node]);
}
```

### Active session tracking
```solidity
mapping(bytes32 => uint256) public rotationNonces;

function isCurrentSessionAddress(bytes32 node, address candidate)
    external view returns (bool) {
    uint256 nonce = rotationNonces[node];
    uint256 epoch = block.timestamp / EPOCH_SECONDS;
    return deriveAddress(node, nonce, epoch) == candidate;
}
```

---

## Fileverse Rules — `engine/orders.ts`

### The Fileverse API is REST — NOT the @fileverse/agents npm SDK

> **⚠️ The `@fileverse/agents` npm package is NOT used.** Do not install it. Do not import it.
> The hackathon Fileverse integration is a plain REST API against your own deployed server.
> All calls use `fetch()` with your `FILEVERSE_API_KEY` and `FILEVERSE_SERVER_URL`.
> The API key is a **query param** (`?apiKey=...`), not a header.
> Do not accidentally log URLs containing it.

### Setup (one-time, no script needed)
1. Go to `ddocs.new` → sign up
2. Settings → Developer Mode → toggle ON
3. Settings → Developer Mode → `+ New API Key` → save as `FILEVERSE_API_KEY`
4. Deploy your server following https://docs.fileverse.io/0x2d133a10443a13957278e7dfeefbfee826c82fd8/117 → save URL as `FILEVERSE_SERVER_URL`
5. Verify: `curl $FILEVERSE_SERVER_URL/ping` → `{"reply":"pong"}`

No `setupFileverse.ts` script. No wallet private key. No Pimlico. No Pinata.

### Complete REST API wrapper — `engine/orders.ts`

```typescript
const SERVER_URL = process.env.FILEVERSE_SERVER_URL!;
const API_KEY   = process.env.FILEVERSE_API_KEY!;

// ── Create a document ──────────────────────────────────────────────────────
// Returns ddocId — save this, it's your reference for all future operations
export async function createDoc(title: string, content: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/ddocs?apiKey=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  const { data } = await res.json();
  return data.ddocId;
}

// ── Wait for on-chain sync and return shareable link ───────────────────────
// Call after createDoc / updateDoc. Polls until syncStatus === 'synced'.
// Typically 5–30 seconds. Times out after 60s.
export async function waitForSync(ddocId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const doc = await getDoc(ddocId);
    if (doc.syncStatus === 'synced') return doc.link;
    if (doc.syncStatus === 'failed') throw new Error(`[Fileverse] Sync failed for ${ddocId}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`[Fileverse] Sync timeout for ${ddocId}`);
}

// ── Read a document ────────────────────────────────────────────────────────
export async function getDoc(ddocId: string): Promise<any> {
  const res = await fetch(`${SERVER_URL}/api/ddocs/${ddocId}?apiKey=${API_KEY}`);
  return res.json(); // { title, content, syncStatus, link, ... }
}

// ── Update a document ──────────────────────────────────────────────────────
export async function updateDoc(ddocId: string, content: string, title?: string): Promise<void> {
  await fetch(`${SERVER_URL}/api/ddocs/${ddocId}?apiKey=${API_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title ? { content, title } : { content }),
  });
}

// ── List documents (native pagination) ────────────────────────────────────
// Use this to enumerate all orders — no local index file needed.
// Returns { ddocs: [...], total, hasNext }
export async function listDocs(limit = 50, skip = 0): Promise<any> {
  const res = await fetch(
    `${SERVER_URL}/api/ddocs?apiKey=${API_KEY}&limit=${limit}&skip=${skip}`
  );
  return res.json();
}

// ── Search documents ───────────────────────────────────────────────────────
// Returns { nodes: [...], total, hasNext } — note: nodes not ddocs
export async function searchDocs(query: string): Promise<any> {
  const res = await fetch(
    `${SERVER_URL}/api/search?apiKey=${API_KEY}&q=${encodeURIComponent(query)}`
  );
  return res.json();
}

// ── Delete a document ──────────────────────────────────────────────────────
export async function deleteDoc(ddocId: string): Promise<void> {
  await fetch(`${SERVER_URL}/api/ddocs/${ddocId}?apiKey=${API_KEY}`, {
    method: 'DELETE',
  });
}
```

### Document ID is `ddocId` — not `fileId`

Every reference to `fileId` in types and logic must be `ddocId`. Update types:

```typescript
// types/index.ts
export interface StoredOrder {
  ddocId: string;               // Fileverse document ID — NOT fileId
  sessionEns: string;
  status: OrderStatus;
  encryptedPayload: string;     // base64 NaCl box — only engine can decrypt
  originalAmount: string;
  remainingAmount: string;
  filledAmount: string;
  parentDdocId: string | null;  // null for root; ddocId of root for all residuals
  submittedAt: number;          // ROOT order timestamp — copied verbatim to residuals
  ttlSeconds: number;
}

export interface DecryptedOrder extends OrderPayload {
  ddocId: string;               // NOT fileId
  subname: string;
  node: `0x${string}`;
  parentDdocId: string | null;
}
```

### Sync status — only share links after `synced`

```typescript
const ddocId = await createDoc('order', JSON.stringify(orderPayload));
const link   = await waitForSync(ddocId); // blocks until on-chain — ~5–30s
// Now proceed — document is confirmed on-chain
```

Never return `doc.link` to users while `syncStatus === 'pending'`.

### No local index file

The Fileverse REST API has native `GET /api/ddocs` pagination. There is no `data/active-orders.json`. Do not create one. On every polling cycle and on startup, use `listDocs()` to fetch the current order book directly from Fileverse.

### Fileverse API gotchas

- **`syncStatus` must be `'synced'`** before the link is valid. Poll with `waitForSync()` after every `createDoc()` and `updateDoc()`.
- **Only one active API key at a time.** Rotating the key invalidates the old one immediately.
- **API key is a query param** `?apiKey=...` — not a header. Don't accidentally log URLs containing it.
- **`search` returns `nodes`, not `ddocs`.** Don't mix up `listDocs()` and `searchDocs()` response types.
- **Retry failed syncs** by polling `GET /api/ddocs/:ddocId` or using the MCP tool `fileverse_retry_failed_events`.

---

## BitGo Rules — `engine/settlement.ts`

### Always env: 'test'. Use Hteth (not Teth) for all send operations.
```typescript
import { BitGoAPI } from '@bitgo/sdk-api';
import { Hteth } from '@bitgo/sdk-coin-eth'; // ⚠️ Hteth for sends — Teth is read-only

let _wallet: any = null;

export async function getBitgoWallet() {
  if (_wallet) return _wallet;
  const bitgo = new BitGoAPI({ env: 'test' });
  bitgo.register('hteth', Hteth.createInstance);
  await bitgo.authenticateWithAccessToken({
    accessToken: process.env.BITGO_ACCESS_TOKEN!
  });
  _wallet = await bitgo.coin('hteth').wallets().get({
    id: process.env.BITGO_WALLET_ID!
  });
  return _wallet;
}
```

### Whitelisting settlement addresses — UPDATE the existing rule, NEVER create new ones

> **CRITICAL:** The whitelist policy was created ONCE in `setupBitgo.ts` and its ID is stored in `WHITELIST_POLICY_ID`. At settlement time, call `updatePolicyRule()` to append addresses to the existing rule. Do NOT call `createPolicyRule()` per settlement — that creates orphaned policy rules.
>
> **PENDING_APPROVAL latency:** Configure the whitelist rule with NO approval requirement so updates auto-activate within seconds. If approvers are set, a human must approve before BitGo co-signs any send — this deadlocks the settlement flow.

```typescript
async function whitelistBothAddresses(
  addressA: string,
  addressB: string
): Promise<void> {
  const wallet = await getBitgoWallet();

  await wallet.updatePolicyRule({
    id: process.env.WHITELIST_POLICY_ID!,
    type: 'advancedWhitelist',
    condition: {
      add: [
        { type: 'address', item: addressA },
        { type: 'address', item: addressB },
      ],
    },
    action: { type: 'deny' },
  });

  // Allow policy to transition PENDING_APPROVAL → ACTIVE
  // Only sufficient if the demo wallet has no approval requirement
  await new Promise(resolve => setTimeout(resolve, 2000));
}
```

### Settlement: sendMany for ETH-only, two sends for ERC-20
```typescript
// ETH-only pairs — sendMany, atomic
export async function settleEthPair(
  buyerSessionAddress: string,
  sellerSessionAddress: string,
  buyerAmount: string,
  sellerAmount: string
) {
  const wallet = await getBitgoWallet();
  await whitelistBothAddresses(buyerSessionAddress, sellerSessionAddress);

  const tx = await wallet.sendMany({
    recipients: [
      { address: buyerSessionAddress, amount: buyerAmount },
      { address: sellerSessionAddress, amount: sellerAmount },
    ],
    walletPassphrase: process.env.BITGO_WALLET_PASSPHRASE!,
  });

  return { txHashes: [tx.txid] };
}

// ERC-20 pairs — two sequential sends, NOT atomic
export async function settleErc20Pair(
  buyerSessionAddress: string,
  sellerSessionAddress: string,
  buyerAmount: string,
  sellerAmount: string,
  orderADdocId: string,
  orderBDdocId: string
) {
  const wallet = await getBitgoWallet();
  await whitelistBothAddresses(buyerSessionAddress, sellerSessionAddress);

  let txHash1: string;

  try {
    const send1 = await wallet.send({
      address: buyerSessionAddress,
      amount: buyerAmount,
      walletPassphrase: process.env.BITGO_WALLET_PASSPHRASE!,
    });
    txHash1 = send1.txid;
  } catch (err) {
    console.error('[Settlement] FATAL — ERC-20 send #1 failed:', err);
    await markOrdersSettlementFailed([orderADdocId, orderBDdocId]);
    throw err;
  }

  try {
    const send2 = await wallet.send({
      address: sellerSessionAddress,
      amount: sellerAmount,
      walletPassphrase: process.env.BITGO_WALLET_PASSPHRASE!,
    });
    return { txHashes: [txHash1, send2.txid] };
  } catch (err) {
    console.error('[Settlement] FATAL — send #2 failed after send #1 confirmed:', {
      txHash1,
      buyerAddress: buyerSessionAddress,
      sellerAddress: sellerSessionAddress,
      error: err,
    });
    await markOrdersPartialSettlement([orderADdocId, orderBDdocId], txHash1);
    throw err; // halt — do NOT retry
  }
}
```

### Settlement sequence — exact order matters
```
1. applyPartialFill()         — update Fileverse state + create residual ddocs (BEFORE BitGo)
2. whitelistBothAddresses()   — UPDATE existing whitelist policy with both session addresses
3. ~2s wait                   — allow policy to go ACTIVE (only if no approval requirement)
4. execute send(s)            — sendMany for ETH-only pairs, two send() for ERC-20 pairs
5. await BitGo webhook        — wait for all tx confirmations on Ethereum Sepolia
6. rotateIfFullyFilled()      — rotate ENS node for fully-filled parties only
7. finalizeSettledOrders()    — mark settled ddocs MATCHED or PARTIALLY_FILLED in Fileverse
8. writeReceipt() x2          — write encrypted settlement receipt ddocs for both parties
```

### Webhook handler
```typescript
app.post('/webhooks/bitgo', async (req, res) => {
  const sig = req.headers['x-signature'] as string;
  const rawBody = JSON.stringify(req.body);
  if (!verifyBitgoSignature(rawBody, sig, process.env.BITGO_WEBHOOK_SECRET!)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  const { type, state, transfer } = req.body;
  if (type === 'transfer' && state === 'confirmed') {
    await handleTransferConfirmed(transfer);
  }
  res.status(200).json({ ok: true }); // always 200 after sig check — prevents BitGo retry storms
});
```

### Never retry BitGo settlement
BitGo errors on send/sendMany must HALT, not retry — double-spend risk. Log, mark orders SETTLEMENT_FAILED in Fileverse via `updateDoc()`, wait for manual intervention.

---

## ENS Session Rules — `engine/session.ts`

### All ENS reads — viem, Ethereum Sepolia
```typescript
export const ensPublicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.ETH_SEPOLIA_RPC!),
});

export const ensWalletClient = createWalletClient({
  chain: sepolia,
  transport: http(process.env.ETH_SEPOLIA_RPC!),
  account: privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`),
});
```

### Generate subname — deterministic from wallet address
```typescript
export function generateSubname(walletAddress: `0x${string}`): string {
  const prefix = walletAddress.slice(2, 7).toLowerCase();
  return `${prefix}.plop.eth`;
}
```

### Resolve subname — always use getEnsAddress, never raw addr()
```typescript
// CORRECT — uses resolve() internally, handles ENSIP-10 wildcard
const address = await ensPublicClient.getEnsAddress({ name: '4a3fb.plop.eth' });

// WRONG — silently fails for wildcard subnames
// const address = await resolver.addr(); ← broken for wildcard
```

### Rotation — only after ALL settlement txs confirm, only for fully filled parties
```typescript
export async function rotateSessionAddress(ensSubname: string): Promise<`0x${string}`> {
  const node = namehash(ensSubname) as `0x${string}`;
  const txHash = await ensWalletClient.writeContract({
    address: process.env.DARK_POOL_RESOLVER_ADDRESS as `0x${string}`,
    abi: DarkPoolResolverABI,
    functionName: 'rotateAddress',
    args: [node],
  });
  await ensPublicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
```

---

## Matching Engine Rules — `engine/matcher.ts`

### Match result type
```typescript
export interface MatchResult {
  orderA: DecryptedOrder;
  orderB: DecryptedOrder;
  fillAmount: bigint;       // min(a.remainingAmount, b.remainingAmount)
  matchedPrice: number;     // midpoint of the two limit prices
  aFullyFilled: boolean;    // remainingAmount === fillAmount for orderA
  bFullyFilled: boolean;    // remainingAmount === fillAmount for orderB
}
```

### Matching — amounts do not need to be equal
```typescript
export function findMatch(orders: DecryptedOrder[]): MatchResult | null {
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const a = orders[i], b = orders[j];

      const inversePair = a.tokenIn === b.tokenOut && a.tokenOut === b.tokenIn;
      if (!inversePair) continue;

      const priceA = parseFloat(a.limitPrice);
      const priceB = parseFloat(b.limitPrice);
      const priceOverlap = a.type === 'SELL' ? priceA <= priceB : priceB <= priceA;
      if (!priceOverlap) continue;

      // submittedAt is always the ROOT order's timestamp — residuals copy it verbatim
      const now = Date.now();
      const notExpired =
        (a.submittedAt + a.ttlSeconds * 1000) > now &&
        (b.submittedAt + b.ttlSeconds * 1000) > now;
      if (!notExpired) continue;

      const aRemaining = BigInt(a.remainingAmount);
      const bRemaining = BigInt(b.remainingAmount);
      const fillAmount = aRemaining < bRemaining ? aRemaining : bRemaining;

      return {
        orderA: a,
        orderB: b,
        fillAmount,
        matchedPrice: (priceA + priceB) / 2,
        aFullyFilled: fillAmount === aRemaining,
        bFullyFilled: fillAmount === bRemaining,
      };
    }
  }
  return null;
}
```

### Apply partial fill — update Fileverse state and create residual ddocs BEFORE BitGo

Three hard rules for residuals:

1. **Status is `'LIVE'`, not `'PENDING'`.** Deposit was confirmed on the root order. Residuals inherit confirmed-collateral status.

2. **`submittedAt` is copied verbatim from the root order.** Never set `submittedAt: Date.now()` on a residual. TTL runs from original order placement.

3. **`encryptedOrder` blob is reused unchanged.** Do not re-encrypt. Same encrypted payload = same limit price, same token pair.

```typescript
export async function applyPartialFill(match: MatchResult): Promise<void> {
  for (const [order, fullyFilled] of [
    [match.orderA, match.aFullyFilled],
    [match.orderB, match.bFullyFilled],
  ] as [DecryptedOrder, boolean][]) {
    const doc = await getDoc(order.ddocId);
    const payload = JSON.parse(doc.content);

    const newFilled    = (BigInt(payload.filledAmount) + match.fillAmount).toString();
    const newRemaining = (BigInt(payload.remainingAmount) - match.fillAmount).toString();

    await updateDoc(order.ddocId, JSON.stringify({
      ...payload,
      filledAmount: newFilled,
      remainingAmount: newRemaining,
      status: fullyFilled ? 'IN_SETTLEMENT' : 'PARTIALLY_FILLED_IN_SETTLEMENT',
      lastFillAt: Date.now(),
    }));

    if (!fullyFilled) {
      const residual = {
        sessionSubname: order.subname,
        encryptedOrder: payload.encryptedOrder,         // reused verbatim
        timestamp: Date.now(),
        status: 'LIVE',                                  // LIVE immediately — not PENDING
        originalAmount: payload.originalAmount,
        filledAmount: newFilled,
        remainingAmount: newRemaining,
        submittedAt: payload.submittedAt,                // ROOT timestamp — NEVER Date.now()
        ttlSeconds: payload.ttlSeconds,
        parentDdocId: payload.parentDdocId ?? order.ddocId,
      };
      const residualDdocId = await createDoc('order-residual', JSON.stringify(residual));
      await waitForSync(residualDdocId); // wait for on-chain commit before proceeding
    }
  }
}
```

### fetchLiveOrders — paginate Fileverse, skip crash-flagged orders
```typescript
async function fetchLiveOrders(): Promise<DecryptedOrder[]> {
  const liveOrders: DecryptedOrder[] = [];
  let skip = 0;
  const limit = 50;

  while (true) {
    const { ddocs, hasNext } = await listDocs(limit, skip);

    for (const doc of ddocs) {
      const payload = JSON.parse(doc.content ?? '{}');

      // Skip mid-flight orders from a previous crash — require manual review
      if (
        payload.status === 'IN_SETTLEMENT' ||
        payload.status === 'PARTIALLY_FILLED_IN_SETTLEMENT'
      ) {
        console.warn(`[Recovery] Order ${doc.ddocId} mid-settlement — skip, manual review`);
        continue;
      }

      if (payload.status !== 'LIVE') continue;

      const order = decryptOrder(
        payload.encryptedOrder.encryptedB64,
        payload.encryptedOrder.nonceB64,
        payload.encryptedOrder.ephemeralPublicKeyB64,
        engineSecretKey
      );

      // TTL — submittedAt is root timestamp (residuals copy verbatim)
      if (Date.now() > payload.submittedAt + payload.ttlSeconds * 1000) {
        await updateDoc(doc.ddocId, JSON.stringify({ ...payload, status: 'EXPIRED' }));
        continue;
      }

      liveOrders.push({
        ...order,
        ddocId: doc.ddocId,
        subname: payload.sessionSubname,
        node: namehash(normalize(payload.sessionSubname)) as `0x${string}`,
        remainingAmount: payload.remainingAmount,
        filledAmount: payload.filledAmount,
        originalAmount: payload.originalAmount,
        parentDdocId: payload.parentDdocId ?? null,
      });
    }

    if (!hasNext) break;
    skip += limit;
  }

  return liveOrders;
}
```

### ENS rotation — only for fully filled parties
```typescript
export async function rotateIfFullyFilled(
  order: DecryptedOrder,
  fullyFilled: boolean
): Promise<void> {
  if (!fullyFilled) return;

  await ensWalletClient.writeContract({
    address: process.env.DARK_POOL_RESOLVER_ADDRESS as `0x${string}`,
    abi: DarkPoolResolverABI,
    functionName: 'rotateAddress',
    args: [order.node],
  });
  await ensWalletClient.writeContract({
    address: process.env.DARK_POOL_RESOLVER_ADDRESS as `0x${string}`,
    abi: DarkPoolResolverABI,
    functionName: 'setText',
    args: [order.node, 'plop.active', 'false'],
  });
}
```

### Matching cycle — full sequence
```typescript
async function matchingCycle(): Promise<void> {
  const orders = await fetchLiveOrders();
  const match = findMatch(orders);
  if (!match) return;

  // Step 1: update Fileverse + create residuals (BEFORE BitGo — crash safety)
  await applyPartialFill(match);

  // Step 2: resolve current ENS session addresses
  const [addressA, addressB] = await Promise.all([
    ensPublicClient.getEnsAddress({ name: normalize(match.orderA.subname) }),
    ensPublicClient.getEnsAddress({ name: normalize(match.orderB.subname) }),
  ]);

  // Step 3: settle fillAmount only
  const { txHashes } = await settle(addressA!, addressB!, match.fillAmount.toString());

  // Step 4: rotate only fully filled parties
  await rotateIfFullyFilled(match.orderA, match.aFullyFilled);
  await rotateIfFullyFilled(match.orderB, match.bFullyFilled);

  // Step 5: finalize status on settled ddocs
  for (const [order, fullyFilled] of [
    [match.orderA, match.aFullyFilled],
    [match.orderB, match.bFullyFilled],
  ] as [DecryptedOrder, boolean][]) {
    const doc = await getDoc(order.ddocId);
    const payload = JSON.parse(doc.content);
    await updateDoc(order.ddocId, JSON.stringify({
      ...payload,
      status: fullyFilled ? 'MATCHED' : 'PARTIALLY_FILLED',
      settledAt: Date.now(),
      settlementTxHash: txHashes.join(','),
    }));
  }

  // Step 6: write encrypted receipts for both parties
  await writeReceipt(match.orderA, match.orderB, match.fillAmount, txHashes, match.matchedPrice, match.aFullyFilled);
  await writeReceipt(match.orderB, match.orderA, match.fillAmount, txHashes, match.matchedPrice, match.bFullyFilled);
}
```

### Zero information leak
- Never log decrypted order payloads
- Only log: ddocIds, ENS subnames, match events, fill amounts (wei), tx hashes
- Mark orders IN_SETTLEMENT / PARTIALLY_FILLED_IN_SETTLEMENT via `updateDoc()` before calling BitGo

---

## General Coding Rules

### TypeScript
- `strict: true` in tsconfig
- All shared types in `types/index.ts` — no inline `interface` or `type` definitions in component files
- No `any` — if you don't know the type, define it

### Error handling
- Fileverse errors → retry up to 3x with 2s backoff, then log and continue
- ENS write errors → retry up to 3x, then alert
- BitGo `send()` or `sendMany()` errors → **HALT, do NOT retry** (double-spend risk)
- ERC-20 partial settlement (send #1 ok, send #2 fails) → mark as PARTIAL_SETTLEMENT, log both addresses and txHash1, require manual resolution
- Webhook handler → always return 200 after signature check, even if processing fails (prevents BitGo retry storms)
- On startup, skip orders with status IN_SETTLEMENT or PARTIALLY_FILLED_IN_SETTLEMENT — log and require manual review

### Security
- Never log: private keys, access tokens, wallet passphrases, decrypted order contents, URLs containing `?apiKey=`
- Never commit `.env` — only `.env.example` with placeholder values
- BitGo passphrase must not be stored in memory after signing — clear the variable

### No local JSON index
The Fileverse REST API has native `GET /api/ddocs` pagination. Do not create or maintain `data/active-orders.json`. Do not add a `data/` directory. The engine always reads order state directly from Fileverse.

### No external database
Fileverse IS the order database — documents are stored as ddocs via REST API. Do not add Postgres, Redis, SQLite, or any other external persistence layer.

### No frontend code in this repo
The frontend lives in Lovable. This repo is engine + contracts only.

### No Uniswap integration
PLOP is a pure OTC P2P dark pool. Mention DEX routing in README as a roadmap item only.

---

## Deployment Order — Run In Sequence

```
Step 1: scripts/deployResolver.ts
  → Deploys DarkPoolResolver.sol to Ethereum Sepolia
  → Save output DARK_POOL_RESOLVER_ADDRESS to .env
  → Then: go to sepolia.app.ens.domains, point plop.eth resolver to this address

Step 2: Fileverse setup (manual — no script)
  → Go to ddocs.new → sign up → Settings → Developer Mode → toggle ON
  → Generate API key → save as FILEVERSE_API_KEY in .env
  → Deploy Fileverse server (follow in-product guide) → save URL as FILEVERSE_SERVER_URL in .env
  → Verify: curl $FILEVERSE_SERVER_URL/ping → {"reply":"pong"}

Step 3: scripts/setupBitgo.ts
  → Creates teth MPC wallet on Ethereum Sepolia at app.bitgo-test.com
  → Creates 3 policy rules (whitelist, velocity, audit webhook)
  → CRITICAL: configure the whitelist rule with NO approval requirement so updates auto-activate
  → Registers webhook pointing to engine URL /webhooks/bitgo
  → Save BITGO_WALLET_ID + all POLICY_IDs to .env

Step 4: engine/index.ts (npm run engine)
  → Calls fetchLiveOrders() on startup — paginates listDocs() to rebuild order book from Fileverse
  → Skips any orders in IN_SETTLEMENT / PARTIALLY_FILLED_IN_SETTLEMENT — log for manual review
  → Verifies Fileverse server reachable (GET /ping)
  → Verifies BitGo wallet balance on Ethereum Sepolia
  → Starts 15s polling loop
  → Starts Express webhook server on ENGINE_PORT
```

---

## Key Constants

```typescript
export const SEPOLIA_CHAIN_ID = 11155111;

export const ENS_REGISTRY_SEPOLIA = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
export const ENS_NAME_WRAPPER_SEPOLIA = '0x0635513f179D50A207757E05759CbD106d7dFcE8';
export const ENS_PUBLIC_RESOLVER_SEPOLIA = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5';
export const ENS_UNIVERSAL_RESOLVER_SEPOLIA = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';

export const EPOCH_SECONDS = 3600;
export const POLL_INTERVAL_MS = 15000;
```

---

## Critical Gotchas — Full Edition

**Fileverse is REST, not SDK.** Do not install or import `@fileverse/agents`. Do not use Pimlico, Pinata, or any wallet private key for Fileverse. All calls use `fetch()` with `?apiKey=` as a query param.

**No local index file.** `data/active-orders.json` does not exist. Always use `listDocs()` pagination to enumerate orders. Do not create a `data/` directory.

**Always `waitForSync()` after writes.** `createDoc()` and `updateDoc()` return with `syncStatus: 'pending'`. The on-chain commit and the `link` field are not available until `syncStatus === 'synced'`. Call `waitForSync(ddocId)` and block before proceeding.

**`search` returns `nodes`, not `ddocs`.** Don't mix up `listDocs()` and `searchDocs()` response shapes.

**ddocId, not fileId.** Every reference to a Fileverse document uses `ddocId`. Update all types. `parentDdocId` for residuals.

**Residual status is `'LIVE'`, not `'PENDING'`.** Collateral was confirmed on the root. Setting residual to `'PENDING'` means it waits forever for a BitGo webhook that will never arrive.

**Residual `submittedAt` must equal root's `submittedAt`.** TTL runs from the original order's placement. Never set `submittedAt: Date.now()` on a residual.

**Whitelist via `updatePolicyRule`, not `createPolicyRule`.** One whitelist rule, stored in `WHITELIST_POLICY_ID`. JIT whitelist = append to existing rule. The rule must have no approvers or settlement deadlocks.

**`applyPartialFill` runs before BitGo.** Order ddocs must be marked `IN_SETTLEMENT` / `PARTIALLY_FILLED_IN_SETTLEMENT` before the settlement send. Prevents concurrent re-matching of in-flight orders.

**Rotate only fully filled parties.** A partially filled party still has a live residual ddoc under their ENS session address. Rotating breaks the address that residual resolves to.

**`fillAmount` sent to BitGo is always `min(remainingA, remainingB)`, never `originalAmount`.**

**Never retry BitGo settlement.** Double-spend risk. Halt, mark SETTLEMENT_FAILED in Fileverse, wait for manual intervention.
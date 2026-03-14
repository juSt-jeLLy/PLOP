# PLOP — Full Flow Documentation
Every operation, every sponsor, every doc link
ENS lives on Ethereum Sepolia (chain ID 11155111). BitGo testnet ETH (`hteth`) runs on Hoodi. Cross-chain by design.

## Before You Write a Single Line of Code
Three accounts to create before the hackathon starts:

| Account | URL | What you get |
|---------|-----|-------------|
| ENS testnet | https://sepolia.app.ens.domains | Register plop.eth, point it at your resolver |
| BitGo testnet | https://app.bitgo-test.com | Access token, wallet ID, passphrase |
| Fileverse | https://ddocs.new | API key + server URL for encrypted doc storage |
| Sepolia faucet | https://sepoliafaucet.com | Testnet ETH for deploying ENS contracts |
| Hoodi faucet | (use your preferred Hoodi faucet) | Testnet ETH for Hoodi deposits/settlement |

Do BitGo first — the 48-hour whitelist lock-in period on new policies means you need the wallet set up on Day 1. Note: during the hackathon demo window (first 48 hours) the whitelist policy is not yet enforced. This is fine — judges will read your setupBitgo.ts and see it's correctly configured. Mention it in your README as expected production behaviour.

> **Fileverse is a REST API — not an npm SDK.**
> Do NOT install `@fileverse/agents`. Do NOT use Pimlico, Pinata, or any wallet private key for Fileverse.
> All Fileverse calls use plain `fetch()` with your `FILEVERSE_API_KEY` and `FILEVERSE_SERVER_URL`.
> The API has native `listDocs()` pagination — no local JSON index file is needed.

## The Four Actors

| Actor | What it is | Lives where |
|-------|-----------|-------------|
| DarkPoolResolver.sol | Custom ENS resolver contract | Ethereum Sepolia |
| Fileverse REST API | Encrypted order book | Off-chain REST + on-chain sync (chain-agnostic) |
| BitGo MPC wallet | Settlement + policy enforcement | Hoodi (hteth) |
| Matching engine | Node.js process, runs off-chain | Your server / localhost |

---

## PHASE 0 — One-Time Setup
Run these scripts once before the demo. They wire everything together.

### 0.1 — Deploy DarkPoolResolver.sol (ENS)
What you're doing: Deploying a custom Solidity contract that acts as the ENS resolver for plop.eth and every *.plop.eth subname. This contract stores rotation nonces and derives fresh addresses deterministically.

Why this exists: ENS allows you to point a name at any resolver contract you write. Instead of storing a static address, your resolver computes one from keccak256(node, nonce, epoch) — this is the auto-rotation mechanic.

The contract implements:

```solidity
// ENSIP-10 wildcard interface — must return true for 0x9061b923
function supportsInterface(bytes4 interfaceID) external pure returns (bool);

// Called by ENS clients for wildcard subnames
function resolve(bytes calldata name, bytes calldata data) 
  external view returns (bytes memory);

// Called directly for non-wildcard resolution
function addr(bytes32 node) external view returns (address payable);

// Called by engine after each settlement — increments nonce, changes address
function rotateAddress(bytes32 node) external onlyEngine;

// Engine writes BitGo deposit address here on session create
function setText(bytes32 node, string calldata key, string calldata value) 
  external onlyEngine;
```

Doc links you need:

| What | Link | Why |
|------|------|-----|
| Writing a custom resolver | https://docs.ens.domains/resolvers/writing/ | Exact interface your contract must implement: addr(), resolve(), supportsInterface(). Shows how ENS calls into your contract. |
| ENSIP-10 spec | https://docs.ens.domains/ensip/10/ | Defines the resolve(bytes name, bytes data) function signature, interface ID 0x9061b923, and exactly how ENS clients call your wildcard resolver |
| ENS deployments (Sepolia addresses) | https://docs.ens.domains/learn/deployments | All Sepolia contract addresses: Registry 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e, NameWrapper 0x0635513f179D50A207757E05759CbD106d7dFcE8, Public Resolver 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5 |
| Subdomain wildcards | https://docs.ens.domains/web/subdomains | Confirms wildcard resolvers serve unlimited subnames without registering each one |

How to deploy (script: scripts/deployResolver.ts):

```typescript
import { createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// 1. Compile DarkPoolResolver.sol with hardhat or forge
// 2. Deploy to Sepolia
const deployTx = await walletClient.deployContract({
  abi: DarkPoolResolverABI,
  bytecode: DarkPoolResolverBytecode,
  args: [ENGINE_ADDRESS], // engine wallet that can call rotateAddress + setText
});

// 3. Wait for receipt, get contract address
const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
const resolverAddress = receipt.contractAddress;

// 4. Go to sepolia.app.ens.domains
// → Your name → Records → Edit → Resolver → set to resolverAddress
// This is a manual step — do it in the UI
```

After deployment: Go to https://sepolia.app.ens.domains, find plop.eth, go to Records → Edit → set Resolver to your deployed contract address. This wires ENS to call YOUR contract for every *.plop.eth lookup.

### 0.1b — Deploy SettlementController.sol (ENS)
What you're doing: Deploying a controller contract that verifies EIP-712 signatures and writes encrypted settlement payloads into `plop.settlement` on the resolver.

Why this exists: We keep settlement recipients private by storing only ciphertext on ENS. The controller ensures the encrypted payload is authorized (signed) without putting the plaintext on-chain.

How to deploy:

```bash
npm run compile:resolver
npm run deploy:settlement-controller
```

Then link it in the resolver:

```bash
# deploy:settlement-controller calls this automatically if ENGINE_PRIVATE_KEY is set
```

Ensure env:
```
SETTLEMENT_CONTROLLER_ADDRESS=<deployed controller>
```

### 0.2 — Initialize Fileverse (Fileverse)
What you're doing: Setting up your Fileverse developer account and getting the API key + server URL needed to create, read, update, and list encrypted order documents.

**No script needed — this is done manually via the ddocs.new UI:**

1. Go to `ddocs.new` → sign up
2. Settings → Developer Mode → toggle **ON**
3. Settings → Developer Mode → `+ New API Key` → save as `FILEVERSE_API_KEY`
4. Deploy your server following https://docs.fileverse.io/0x2d133a10443a13957278e7dfeefbfee826c82fd8/117 → save URL as `FILEVERSE_SERVER_URL`
5. Verify: `curl $FILEVERSE_SERVER_URL/ping` → `{"reply":"pong"}`

> **⚠️ Only one active API key at a time.** Rotating it invalidates the old one immediately — all engine processes using the old key will fail.

What you get: A REST API server that stores encrypted documents (ddocs), each identified by a `ddocId`. Documents sync to on-chain storage — once `syncStatus === 'synced'` the document has a permanent shareable link. The API has native pagination via `GET /api/ddocs` — no local index file is needed to enumerate orders.

Doc links you need:

| What | Link | Why |
|------|------|-----|
| Fileverse hackathon guide | https://docs.fileverse.io/0x2d133a10443a13957278e7dfeefbfee826c82fd8/117 | Step-by-step setup: deploy server, get API key, REST API reference |
| Monitor document activity | https://ddocs.new | Web UI to see all your documents, sync status, and shareable links |

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
// Typically takes 5–30 seconds. Times out after 60s.
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
// Only send fields you want to change — title is optional
export async function updateDoc(ddocId: string, content: string, title?: string): Promise<void> {
  await fetch(`${SERVER_URL}/api/ddocs/${ddocId}?apiKey=${API_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title ? { content, title } : { content }),
  });
}

// ── List documents (native pagination) ────────────────────────────────────
// No local index file needed — use this to enumerate all live orders.
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

### 0.3 — Create BitGo MPC Wallet (BitGo)
What you're doing: Creating a self-custody MPC hot wallet for hteth (Hoodi testnet ETH) on BitGo testnet, then configuring 3 policy rules that enforce the dark pool's trust model.

The MPC key structure: You hold the user key (encrypted by your passphrase) + backup key. BitGo holds key 3. To move funds, you sign with user key + BitGo co-signs with key 3. BitGo's co-sign is gated by your policy rules — a policy violation = BitGo refuses to co-sign = transaction fails. No single party can move funds.

For Ethereum specifically: Ethereum uses MPC (threshold signature scheme / TSS), not multisig. This means the wallet is a regular EOA address, not a smart contract.

> **⚠️ MPC wallet creation: use generateMPCKeys() + wallets().add() — NOT generateWallet().**
> `generateWallet()` is the multisig wallet creation path. For MPC hot wallets (which is what PLOP uses), the correct flow is:
> 1. `coin.keychains().createBitGo()` — BitGo generates key 3 server-side
> 2. `coin.keychains().add({ ...userKey })` — add your user key
> 3. `coin.keychains().add({ ...backupKey })` — add your backup key
> 4. `coin.wallets().add({ keys: [bitGoKeyId, userKeyId, backupKeyId], ... })` — create the wallet
>
> The exact parameter names differ between SDK versions — always verify against https://developers.bitgo.com/docs/wallets-create-mpc-keys before running.

Doc links you need:

| What | Link | Why |
|------|------|-----|
| SDK install + testnet auth | https://developers.bitgo.com/docs/get-started-sdk-install | npm install bitgo. How to authenticate with env: 'test' and access token |
| Environments | https://developers.bitgo.com/docs/get-started-environments | Confirms env: 'test' → app.bitgo-test.com. All testnet ops go here |
| Wallet types overview | https://developers.bitgo.com/concepts/wallet-types | Explains MPC hot wallet — what you need. Self-custody, hot, simple withdrawal flow |
| Create MPC keys | https://developers.bitgo.com/docs/wallets-create-mpc-keys | Correct MPC key creation flow — generateMPCKeys() pattern, not generateWallet() |
| Create wallet | https://developers.bitgo.com/docs/wallets-create-wallets | Step 2: create wallet with the 3 MPC keys using wallets().add(). Use coin: 'hteth' |
| Create whitelist policy | https://developers.bitgo.com/docs/wallets-whitelists-create | Create advancedWhitelist policy with action: { type: 'deny' } — blocks any send to non-whitelisted address |
| Create velocity policy | https://developers.bitgo.com/docs/policies-create | Velocity limit — max outflow per rolling hour window |
| Webhook setup | https://developers.bitgo.com/docs/webhooks-wallet | type: 'transfer' webhook — fires on deposit confirm (order goes live) and settlement confirm (trigger rotation) |
| Testnet dashboard | https://app.bitgo-test.com | Create account here. View wallets, pending txs, webhook logs |

How to create wallet + policies (script: scripts/setupBitgo.ts):

```typescript
import { BitGoAPI } from '@bitgo/sdk-api';
import { Teth } from '@bitgo/sdk-coin-eth';
import { Hteth } from '@bitgo/sdk-coin-eth';

const bitgo = new BitGoAPI({ env: 'test' });
bitgo.register('teth', Teth.createInstance);
bitgo.register('hteth', Hteth.createInstance);
bitgo.authenticateWithAccessToken({ accessToken: process.env.BITGO_ACCESS_TOKEN! });

const coin = bitgo.coin('hteth');

// Step 1: MPC key creation
const bitgoKey = await coin.keychains().createBitGo({});
const userKey = await coin.keychains().create({
  passphrase: process.env.BITGO_WALLET_PASSPHRASE!,
});
const backupKey = await coin.keychains().create({
  passphrase: process.env.BITGO_WALLET_PASSPHRASE!,
});

// Step 2: Create wallet
const wallet = await coin.wallets().add({
  label: 'plop-pool-wallet',
  enterprise: process.env.BITGO_ENTERPRISE_ID!,
  keys: [bitgoKey.id, userKey.id, backupKey.id],
  m: 2,
  n: 3,
});

// Step 3: Create whitelist policy — CRITICAL: configure with NO approval requirement
// so JIT updates go ACTIVE within seconds (no human approval deadlock)
await wallet.createPolicyRule({
  id: 'plop-destination-whitelist',
  type: 'advancedWhitelist',
  condition: { add: { type: 'address', item: 'PLACEHOLDER' } },
  action: { type: 'deny' },
  // approvers: []  ← do NOT set approvers
});

// Step 4: Create velocity limit
await wallet.createPolicyRule({
  id: 'plop-velocity-limit',
  type: 'velocityLimit',
  condition: {
    amount: '1000000000000000000',
    timeWindow: 3600,
    grouping: 'walletId',
  },
  action: { type: 'deny' },
});

// Step 5: Create audit webhook
await wallet.addWebhook({
  type: 'transfer',
  url: `${process.env.ENGINE_URL}/webhooks/bitgo`,
  label: 'plop-transfer-events',
  numConfirmations: 1,
});
```

> **⚠️ 48-hour lock warning:** New whitelist policies on self-custody wallets lock 48 hours after creation. During the hackathon demo this lock hasn't kicked in yet — note it in your README as expected production behaviour.

---

## PHASE 1 — Trader Connects (Session Creation)
Trigger: Trader connects their MetaMask to the PLOP frontend.

### 1.1 — Generate Anonymous Session Subname (ENS)

```typescript
import { normalize, namehash } from 'viem/ens';

function generateSessionSubname(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const slug = Array.from({ length: 5 }, () => 
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
  return `${slug}.plop.eth`;
}

const subname = generateSessionSubname(); // 'x7k2m.plop.eth'
const node = namehash(normalize(subname)); // bytes32 — used in all contract calls
```

### 1.2 — Create BitGo Deposit Address for This Session (BitGo)

```typescript
const walletInstance = await bitgo.coin('hteth').wallets().get({ 
  id: process.env.BITGO_WALLET_ID! 
});

const { address } = await walletInstance.createAddress({ 
  label: `session-${subname}`
});
```

### 1.3 — Write Deposit Address to ENS Text Record (ENS)

```typescript
await engineWallet.writeContract({
  address: DARK_POOL_RESOLVER_ADDRESS,
  abi: DarkPoolResolverABI,
  functionName: 'setText',
  args: [node, 'plop.deposit', bitgoDepositAddress],
});

// Encrypt settlement instructions client-side with ENGINE_PUBLIC_KEY
const encryptedPayload = buildEncryptedSettlementPayload({
  recipient: traderSettlementAddress,
  chainId: 560048,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  nonce: randomHex32(),
});

// Sign an authorization over the ciphertext hash
const payloadHash = keccak256(bytes(encryptedPayload));
const signature = await wallet.signTypedData({
  domain: {
    name: 'PlopSettlementController',
    version: '1',
    chainId: 11155111,
    verifyingContract: SETTLEMENT_CONTROLLER_ADDRESS,
  },
  types: {
    SettlementAuthorization: [
      { name: 'node', type: 'bytes32' },
      { name: 'payloadHash', type: 'bytes32' },
      { name: 'expiry', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'SettlementAuthorization',
  message: {
    node,
    payloadHash,
    expiry,
    nonce,
  },
});

// Controller verifies signature + writes ciphertext to ENS
await settlementController.writeContract({
  address: SETTLEMENT_CONTROLLER_ADDRESS,
  abi: SettlementControllerABI,
  functionName: 'recordSettlement',
  args: [node, encryptedPayload, expiry, nonce, signature],
});

await engineWallet.writeContract({
  address: DARK_POOL_RESOLVER_ADDRESS,
  abi: DarkPoolResolverABI,
  functionName: 'setText',
  args: [node, 'plop.active', 'true'],
});
```

---

## PHASE 2 — Order Submission
Trigger: Trader fills the order form and clicks Submit.

### 2.1 — Encrypt Order Client-Side (NaCl)

```typescript
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8 } from 'tweetnacl-util';

function encryptOrder(order: Order): string {
  const message = encodeUTF8(JSON.stringify(order));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ephemeralKeyPair = nacl.box.keyPair();

  const encrypted = nacl.box(
    message,
    nonce,
    enginePublicKey,
    ephemeralKeyPair.secretKey,
  );

  return JSON.stringify({
    encryptedB64: encodeBase64(encrypted),
    nonceB64: encodeBase64(nonce),
    ephemeralPublicKeyB64: encodeBase64(ephemeralKeyPair.publicKey),
  });
}
```

### 2.2 — Upload Encrypted Order to Fileverse (Fileverse)
What you're doing: Calling `createDoc()` to store the encrypted order via the Fileverse REST API, then calling `waitForSync()` to get the on-chain confirmed link.

What gets stored where:
* Fileverse server: the encrypted JSON blob
* On-chain (via Fileverse sync): the content hash — proves the order existed, immutable

```typescript
const orderPayload = {
  sessionSubname: 'x7k2m.plop.eth',
  encryptedOrder: encryptedPayload,
  timestamp: Date.now(),
  status: 'PENDING_DEPOSIT',
  originalAmount: order.amount,
  filledAmount: '0',
  remainingAmount: order.amount,
  parentDdocId: null,
  submittedAt: Date.now(),  // ROOT timestamp — copied verbatim to all residuals
  ttlSeconds: order.ttlSeconds,
};

const ddocId = await createDoc('order', JSON.stringify(orderPayload));
await waitForSync(ddocId); // wait for on-chain commit before marking order live
```

---

## PHASE 3 — Collateral Deposit
Trigger: UI shows the trader their BitGo deposit address. Trader manually sends hteth (Hoodi) to that address.

### 3.1 — BitGo Fires Deposit Webhook (BitGo)

```typescript
app.post('/webhooks/bitgo', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-bitgo-signature'];
  const expected = crypto
    .createHmac('sha256', process.env.BITGO_WEBHOOK_SECRET!)
    .update(req.body)
    .digest('hex');
  if (sig !== expected) return res.status(401).send('Invalid signature');

  const event = JSON.parse(req.body.toString());
  
  if (event.type === 'transfer' && event.state === 'confirmed') {
    const depositAddress = event.transfer.entries
      .find((e: any) => e.value > 0)?.address;
    await activateOrder(depositAddress);
  }

  res.status(200).send('ok');
});
```

> **Local Hoodi fallback:** if BitGo webhooks aren’t reachable in local testing, the engine can poll Hoodi balances and mark orders LIVE based on `depositAddress` + `originalAmount`.

### 3.2 — Activate Order in Fileverse (Fileverse)
Find the ddocId by searching Fileverse for the deposit address, then update status to LIVE.

```typescript
async function activateOrder(depositAddress: string) {
  // Search for the pending order matching this deposit address
  const results = await searchDocs(depositAddress);
  const match = results.nodes?.find((n: any) => {
    const payload = JSON.parse(n.content ?? '{}');
    return payload.status === 'PENDING_DEPOSIT';
  });
  if (!match) return;

  const existing = JSON.parse(match.content);
  await updateDoc(match.ddocId, JSON.stringify({
    ...existing,
    status: 'LIVE',
    activatedAt: Date.now(),
  }));
}
```

---

## PHASE 4 — Matching Engine
Trigger: The engine's 15-second polling loop.

### 4.1 — Poll Fileverse for Live Orders (Fileverse)
What you're doing: Using the native `listDocs()` pagination to fetch all documents, filtering for LIVE orders, decrypting each, and building the in-memory order book. No local index file needed.

> **On engine startup:** Call `fetchLiveOrders()` immediately to rebuild the in-memory order map from Fileverse before the first polling cycle. Any order in status `IN_SETTLEMENT` or `PARTIALLY_FILLED_IN_SETTLEMENT` must be skipped and flagged for manual review.

```typescript
async function fetchLiveOrders(): Promise<DecryptedOrder[]> {
  const liveOrders: DecryptedOrder[] = [];
  let skip = 0;
  const limit = 50;

  while (true) {
    const { ddocs, hasNext } = await listDocs(limit, skip);

    for (const doc of ddocs) {
      const payload = JSON.parse(doc.content ?? '{}');

      // Skip crash-flagged orders
      if (
        payload.status === 'IN_SETTLEMENT' ||
        payload.status === 'PARTIALLY_FILLED_IN_SETTLEMENT'
      ) {
        console.warn(`[Recovery] Order ${doc.ddocId} mid-settlement — skip, manual review`);
        continue;
      }

      if (payload.status !== 'LIVE') continue;

      const order = decryptOrder(payload.encryptedOrder, engineSecretKey);

      // TTL uses root submittedAt — residuals copy it verbatim
      if (Date.now() > payload.submittedAt + payload.ttlSeconds * 1000) {
        await updateDoc(doc.ddocId, JSON.stringify({ ...payload, status: 'EXPIRED' }));
        continue;
      }

      liveOrders.push({
        ...order,
        ddocId: doc.ddocId,
        subname: payload.sessionSubname,
        node: namehash(normalize(payload.sessionSubname)) as `0x${string}`,
        remainingAmount: BigInt(payload.remainingAmount),
        originalAmount: BigInt(payload.originalAmount),
        filledAmount: BigInt(payload.filledAmount),
        parentDdocId: payload.parentDdocId ?? null,
      });
    }

    if (!hasNext) break;
    skip += limit;
  }

  return liveOrders;
}
```

### 4.2 — Find a Match with Partial Fill Support (Engine Logic)

```typescript
interface MatchResult {
  orderA: DecryptedOrder;
  orderB: DecryptedOrder;
  fillAmount: bigint;
  matchedPrice: number;
  aFullyFilled: boolean;
  bFullyFilled: boolean;
}

function findMatch(orders: DecryptedOrder[]): MatchResult | null {
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const a = orders[i], b = orders[j];

      const inversePair = a.tokenIn === b.tokenOut && a.tokenOut === b.tokenIn;
      if (!inversePair) continue;

      const priceA = parseFloat(a.limitPrice);
      const priceB = parseFloat(b.limitPrice);
      const priceOverlap = a.type === 'SELL' ? priceA <= priceB : priceB <= priceA;
      if (!priceOverlap) continue;

      // TTL measured from root submittedAt — never residual creation time
      const now = Date.now();
      const notExpired =
        (a.submittedAt + a.ttlSeconds * 1000) > now &&
        (b.submittedAt + b.ttlSeconds * 1000) > now;
      if (!notExpired) continue;

      const fillAmount = a.remainingAmount < b.remainingAmount
        ? a.remainingAmount
        : b.remainingAmount;

      return {
        orderA: a,
        orderB: b,
        fillAmount,
        matchedPrice: (priceA + priceB) / 2,
        aFullyFilled: fillAmount === a.remainingAmount,
        bFullyFilled: fillAmount === b.remainingAmount,
      };
    }
  }
  return null;
}
```

### 4.3 — Update Order State and Create Residuals (Fileverse)
Call this BEFORE invoking BitGo. Updates both order documents and creates residual ddocs for partially filled sides.

```typescript
async function applyPartialFill(match: MatchResult): Promise<void> {
  for (const [order, fullyFilled] of [
    [match.orderA, match.aFullyFilled],
    [match.orderB, match.bFullyFilled],
  ] as [DecryptedOrder, boolean][]) {
    const doc = await getDoc(order.ddocId);
    const payload = JSON.parse(doc.content);

    const newFilledAmount = (BigInt(payload.filledAmount) + match.fillAmount).toString();
    const newRemainingAmount = (BigInt(payload.remainingAmount) - match.fillAmount).toString();

    await updateDoc(order.ddocId, JSON.stringify({
      ...payload,
      filledAmount: newFilledAmount,
      remainingAmount: newRemainingAmount,
      status: fullyFilled ? 'IN_SETTLEMENT' : 'PARTIALLY_FILLED_IN_SETTLEMENT',
      lastFillAt: Date.now(),
    }));

    if (!fullyFilled) {
      const residualPayload = {
        sessionSubname: order.subname,
        encryptedOrder: payload.encryptedOrder,  // reused verbatim — same price, same pair
        timestamp: Date.now(),
        status: 'LIVE',                           // LIVE immediately — deposit already confirmed
        originalAmount: payload.originalAmount,
        filledAmount: newFilledAmount,
        remainingAmount: newRemainingAmount,
        submittedAt: payload.submittedAt,          // ROOT timestamp — NEVER Date.now()
        ttlSeconds: payload.ttlSeconds,
        parentDdocId: payload.parentDdocId ?? order.ddocId,
      };

      const residualDdocId = await createDoc('order-residual', JSON.stringify(residualPayload));
      await waitForSync(residualDdocId); // wait for on-chain commit before proceeding
    }
  }
}
```

---

## PHASE 5 — Settlement
Trigger: A match is found. Engine calls `applyPartialFill()` first, then proceeds to BitGo settlement for `fillAmount` only.

### 5.1 — Whitelist Both Settlement Addresses (BitGo)
UPDATE the existing whitelist policy rule — never create new ones per settlement.

```typescript
async function whitelistSettlementAddresses(
  addressA: string, 
  addressB: string
): Promise<void> {
  const walletInstance = await bitgo.coin('hteth').wallets()
    .get({ id: process.env.BITGO_WALLET_ID! });

  // UPDATE the existing rule — append both addresses
  await walletInstance.updatePolicyRule({
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

  // Allow policy to go ACTIVE (only if no approval requirement on the rule)
  await new Promise(resolve => setTimeout(resolve, 2000));
}
```

### 5.2 — Resolve Settlement Addresses from ENS (ENS)

```typescript
const [addressA, addressB] = await Promise.all([
  publicClient.getEnsAddress({ name: normalize(orderA.subname) }),
  publicClient.getEnsAddress({ name: normalize(orderB.subname) }),
]);
```

### 5.3 — Execute Settlement (BitGo)

> **⚠️ sendMany() is native ETH only.** ERC-20 pairs require two sequential `send()` calls.
> **⚠️ Import Hteth for sends — not Teth.**

```typescript
import { Hteth } from '@bitgo/sdk-coin-eth';

// ETH-only pairs: sendMany (atomic)
if (isEthOnlyPair(orderA, orderB)) {
  const result = await wallet.sendMany({
    recipients: [
      { address: addressA, amount: String(fillAmountInWei) },
      { address: addressB, amount: String(fillAmountInWei) },
    ],
    walletPassphrase: process.env.BITGO_WALLET_PASSPHRASE!,
  });
  return { txHashes: [result.txid] };
}

// ERC-20 pairs: two sequential sends (not atomic)
let txHash1: string;
try {
  const send1 = await wallet.send({
    address: addressA,
    amount: String(fillAmountInWei),
    walletPassphrase: process.env.BITGO_WALLET_PASSPHRASE!,
  });
  txHash1 = send1.txid;
} catch (err) {
  console.error('[Settlement] FATAL — send #1 failed:', err);
  throw err; // halt, do not retry
}

try {
  const send2 = await wallet.send({
    address: addressB,
    amount: String(fillAmountInWei),
    walletPassphrase: process.env.BITGO_WALLET_PASSPHRASE!,
  });
  return { txHashes: [txHash1, send2.txid] };
} catch (err) {
  console.error('[Settlement] FATAL — send #2 failed after send #1 confirmed:', {
    txHash1, addressA, addressB, error: err,
  });
  throw err; // halt, alert, do NOT retry
}
```

> **NEVER retry on error** — double-spend risk. Log the error, mark orders SETTLEMENT_FAILED in Fileverse, wait for manual intervention.

---

## PHASE 6 — Post-Settlement (Address Rotation + Receipt)
Trigger: BitGo fires a transfer webhook when ALL settlement txs confirm on Hoodi.

### 6.1 — Rotate ENS Addresses — Fully Filled Sides Only (ENS)

```typescript
for (const [order, fullyFilled] of [
  [match.orderA, match.aFullyFilled],
  [match.orderB, match.bFullyFilled],
] as const) {
  if (!fullyFilled) continue; // residual still needs this session address

  await engineWallet.writeContract({
    address: DARK_POOL_RESOLVER_ADDRESS,
    abi: DarkPoolResolverABI,
    functionName: 'rotateAddress',
    args: [order.node],
  });

  await engineWallet.writeContract({
    address: DARK_POOL_RESOLVER_ADDRESS,
    abi: DarkPoolResolverABI,
    functionName: 'setText',
    args: [order.node, 'plop.active', 'false'],
  });
}
```

### 6.2 — Mark Orders in Fileverse (Fileverse)

```typescript
for (const [order, fullyFilled] of [
  [match.orderA, match.aFullyFilled],
  [match.orderB, match.bFullyFilled],
] as const) {
  const doc = await getDoc(order.ddocId);
  const payload = JSON.parse(doc.content);
  await updateDoc(order.ddocId, JSON.stringify({
    ...payload,
    status: fullyFilled ? 'MATCHED' : 'PARTIALLY_FILLED',
    settledAt: Date.now(),
    settlementTxHash: txHashes.join(','),
  }));
}
```

### 6.3 — Write Encrypted Settlement Receipt (Fileverse)

```typescript
async function writeReceipt(
  order: DecryptedOrder,
  counterparty: DecryptedOrder,
  fillAmount: bigint,
  txHashes: string[],
  matchedPrice: number,
  fullyFilled: boolean
) {
  const receipt = {
    txHashes,
    matchedPrice,
    timestamp: Date.now(),
    counterparty: counterparty.subname,
    youSent: order.sellToken,
    youReceived: order.buyToken,
    fillAmount: fillAmount.toString(),
    originalAmount: order.originalAmount.toString(),
    totalFilledAmount: (BigInt(order.filledAmount) + fillAmount).toString(),
    remainingAmount: (BigInt(order.remainingAmount) - fillAmount).toString(),
    fullyFilled,
    parentDdocId: order.parentDdocId ?? null,
  };

  const encryptedReceipt = encryptForTrader(JSON.stringify(receipt), order.traderPublicKey);

  const receiptDdocId = await createDoc('settlement-receipt', JSON.stringify({
    type: 'settlement-receipt',
    sessionSubname: order.subname,
    encryptedReceipt,
    timestamp: Date.now(),
  }));

  await waitForSync(receiptDdocId);

  // Append receiptDdocId to ENS text record (comma-separated for multiple fills)
  const existingReceipts = await publicClient.getEnsText({
    name: normalize(order.subname),
    key: 'plop.receipts',
  }) ?? '';
  const updatedReceipts = existingReceipts
    ? `${existingReceipts},${receiptDdocId}`
    : receiptDdocId;

  await engineWallet.writeContract({
    address: DARK_POOL_RESOLVER_ADDRESS,
    abi: DarkPoolResolverABI,
    functionName: 'setText',
    args: [order.node, 'plop.receipts', updatedReceipts],
  });
}
```

---

## Quick Reference — All Doc Links by Sponsor

### 🟦 ENS

| Operation | Doc |
|-----------|-----|
| Register plop.eth on testnet | https://sepolia.app.ens.domains |
| Write custom resolver contract | https://docs.ens.domains/resolvers/writing/ |
| ENSIP-10 wildcard + resolve() | https://docs.ens.domains/ensip/10/ |
| Sepolia contract addresses | https://docs.ens.domains/learn/deployments |
| Text records (read/write) | https://docs.ens.domains/web/records |
| Subnames (wildcard behavior) | https://docs.ens.domains/web/subdomains |
| Resolution flow (debugging) | https://docs.ens.domains/web/resolution/ |
| viem getEnsAddress | https://viem.sh/docs/ens/actions/getEnsAddress |
| viem namehash | https://viem.sh/docs/ens/utilities/namehash |

### 🟣 Fileverse

| Operation | Doc |
|-----------|-----|
| Setup + full REST API reference | https://docs.fileverse.io/0x2d133a10443a13957278e7dfeefbfee826c82fd8/117 |
| Monitor document activity | https://ddocs.new |

### 🟢 BitGo

| Operation | Doc |
|-----------|-----|
| SDK install + testnet auth | https://developers.bitgo.com/docs/get-started-sdk-install |
| Testnet environment | https://developers.bitgo.com/docs/get-started-environments |
| Wallet types (use MPC hot) | https://developers.bitgo.com/concepts/wallet-types |
| Create MPC keys | https://developers.bitgo.com/docs/wallets-create-mpc-keys |
| Create wallet (use wallets().add() with MPC keys) | https://developers.bitgo.com/docs/wallets-create-wallets |
| Create address per session | https://developers.bitgo.com/docs/wallets-create-addresses |
| Create whitelist policy | https://developers.bitgo.com/docs/wallets-whitelists-create |
| Update whitelist (JIT at match time) | https://developers.bitgo.com/docs/wallets-whitelists-update |
| Create velocity limit | https://developers.bitgo.com/docs/policies-create |
| Webhook setup | https://developers.bitgo.com/docs/webhooks-wallet |
| sendMany / send — import Hteth, not Teth | https://developers.bitgo.com/docs/withdraw-wallet-type-self-custody-mpc-hot-simple |
| Testnet dashboard | https://app.bitgo-test.com |

### 📦 Encryption

| Operation | Doc |
|-----------|-----|
| TweetNaCl box encryption | https://www.npmjs.com/package/tweetnacl |
| TweetNaCl utils | https://www.npmjs.com/package/tweetnacl-util |

---

## Critical Gotchas

**ENS:** Never call raw addr() on wildcard subnames — use viem's getEnsAddress() which goes through resolve() (ENSIP-10). Raw addr() silently returns zero address for wildcard names.

**Fileverse:** The API is REST — not the `@fileverse/agents` npm SDK. Do not install it. All calls use `fetch()` with `?apiKey=YOUR_KEY`. The API has native `listDocs()` pagination — no local `data/active-orders.json` index file is needed. Always `waitForSync()` after `createDoc()` and `updateDoc()` before using the link. `syncStatus` must be `'synced'` — never share `doc.link` while `pending`.

**Fileverse search returns `nodes`, not `ddocs`.** The shape of `GET /api/search` responses differs from `GET /api/ddocs`. Don't mix up `listDocs()` and `searchDocs()` response types.

**Fileverse API key is a query param** (`?apiKey=...`), not a header. Only one active key at a time — rotation invalidates the old one immediately.

**BitGo wallet creation:** `generateWallet()` is for multisig wallets only. For MPC hot wallets use `generateMPCKeys()` (or the equivalent key creation flow) followed by `wallets().add()`. Verify against https://developers.bitgo.com/docs/wallets-create-mpc-keys before running.

**BitGo sends:** Always import `Hteth` and use `bitgo.coin('hteth')` for `send()` or `sendMany()`. `Teth` is for wallet setup and read operations only.

**BitGo whitelist:** At match time, call `updatePolicyRule()` with `WHITELIST_POLICY_ID` — never `createPolicyRule()`. Creating a rule per settlement spawns orphaned rules that accumulate. The whitelist rule must have no `approvers` — otherwise policy updates deadlock at `PENDING_APPROVAL`.

**BitGo:** `sendMany()` is for native ETH only — ERC-20 pairs require two sequential `send()` calls. For any failed send, HALT and do not retry (double-spend risk). Testnet OTP for unlock is always 000000.

**Rotation:** Only rotate a party's ENS address when their order is fully filled (`remainingAmount === 0`). A partially filled party still has a live residual in the book. Rotation is irreversible. For ERC-20 pairs, wait for both sends to confirm before rotating anyone.

**Partial fills:** Always call `applyPartialFill()` and write residuals to Fileverse BEFORE calling BitGo. Residual status is always `'LIVE'` (not `'PENDING'`) — the deposit was already confirmed on the root order. Residual `submittedAt` must be copied verbatim from root — TTL always runs from original order placement. The `encryptedOrder` blob is reused unchanged.

**Crash recovery:** On engine startup, call `fetchLiveOrders()` using `listDocs()` pagination to rebuild the in-memory order map from Fileverse. Skip any order with status `IN_SETTLEMENT` or `PARTIALLY_FILLED_IN_SETTLEMENT` — these need manual review.

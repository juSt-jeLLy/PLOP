# PLOP — Complete Build Guide (Start to Finish)

Everything in the exact order you do it. Each step tells you what you get out of it and where that value goes next.

---

## Before You Touch Any Code — Account Setup

### Step 1 — Create BitGo Testnet Account

1. Go to **https://app.bitgo-test.com** → Sign up
2. Verify your email
3. Go to **Settings → Developer Options → Add Access Token**
   - Give it a name (e.g. `plop-hackathon`)
   - Set expiry (max out the time)
   - Copy the token **immediately** — it's only shown once
4. Go to **Settings → Enterprise** tab
   - Copy your **Enterprise ID** (looks like `67a3f...`)

**You now have:**
```
BITGO_ACCESS_TOKEN=v2x1a2b3c4...
BITGO_ENTERPRISE_ID=67a3f...
```

---

### Step 2 — Create Fileverse Account

1. Go to **https://ddocs.new** → Sign up
2. Go to **Settings → Developer Mode** → toggle **ON**
3. Go to **Settings → Developer Mode → + New API Key**
   - Name it (e.g. `plop-engine`)
   - Copy the key
4. Deploy your Fileverse server by following **https://docs.fileverse.io/0x2d133a10443a13957278e7dfeefbfee826c82fd8/117**
   - At the end of the deploy flow you get a server URL
   - Verify it works: `curl https://YOUR_SERVER_URL/ping` → should return `{"reply":"pong"}`

**You now have:**
```
FILEVERSE_API_KEY=fv_...
FILEVERSE_SERVER_URL=https://your-server.fileverse.io
```

---

### Step 3 — Create ENS Testnet Account + Register plop.eth

1. Go to **https://sepolia.app.ens.domains**
2. Connect your MetaMask wallet (switch to **Sepolia testnet**)
3. Get Sepolia ETH from **https://sepoliafaucet.com** if your wallet is empty
4. Search for `plop.eth` → Register it (costs a tiny bit of Sepolia ETH)
5. **Don't set the resolver yet** — you'll do that after deploying your contract in Step 7

**You now have:**
- `plop.eth` registered on Sepolia, pointing at the default resolver (temporary)
- Your deployer wallet address + private key (the MetaMask wallet you used)

```
DEPLOYER_PRIVATE_KEY=0x...   # the wallet that registered plop.eth
ETH_SEPOLIA_RPC=https://sepolia.infura.io/v3/YOUR_KEY   # get a free key at infura.io
```

---

## Code Setup

### Step 4 — Clone Repo + Install Dependencies

```bash
git clone https://github.com/your-org/plop
cd plop
npm install
```

Create your `.env` file and fill in what you have so far:

```bash
cp .env.example .env
```

`.env` at this point:
```
ETH_SEPOLIA_RPC=https://sepolia.infura.io/v3/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...

FILEVERSE_API_KEY=fv_...
FILEVERSE_SERVER_URL=https://your-server.fileverse.io

BITGO_ENV=test
BITGO_ACCESS_TOKEN=v2x1a2b3...
BITGO_ENTERPRISE_ID=67a3f...

ENGINE_PORT=3001
ENGINE_POLL_INTERVAL_MS=15000
EPOCH_SECONDS=3600

# These get filled in as you run the scripts below:
DARK_POOL_RESOLVER_ADDRESS=
BITGO_WALLET_ID=
BITGO_WALLET_PASSPHRASE=
BITGO_WEBHOOK_SECRET=
WHITELIST_POLICY_ID=
VELOCITY_POLICY_ID=
AUDIT_WEBHOOK_POLICY_ID=
ENGINE_URL=http://localhost:3001
```

---

## Deploy Contracts

### Step 5 — Compile DarkPoolResolver.sol

```bash
npx hardhat compile
# or
forge build
```

Make sure `contracts/DarkPoolResolver.sol` compiles with no errors before proceeding.

---

### Step 6 — Deploy DarkPoolResolver.sol to Sepolia

```bash
npx ts-node scripts/deployResolver.ts
```

This script:
- Deploys `DarkPoolResolver.sol` to Ethereum Sepolia
- Passes your `DEPLOYER_PRIVATE_KEY` wallet address as the `engine` (the only address allowed to call `rotateAddress` and `setText`)
- Prints the deployed contract address when done

**Output looks like:**
```
Deploying DarkPoolResolver...
Transaction hash: 0xabc123...
Contract deployed at: 0x4a3F8b...
```

Copy that address into your `.env`:
```
DARK_POOL_RESOLVER_ADDRESS=0x4a3F8b...
```

---

### Step 7 — Point plop.eth at Your Resolver (Manual, 2 minutes)

1. Go to **https://sepolia.app.ens.domains**
2. Search `plop.eth` → click it → go to **Records → Edit**
3. Find the **Resolver** field
4. Paste in your `DARK_POOL_RESOLVER_ADDRESS` from Step 6
5. Click **Save** → confirm the MetaMask transaction

**After this:** Every `*.plop.eth` lookup on Sepolia now calls YOUR contract. No more default resolver.

---

## BitGo Wallet Setup

### Step 8 — Choose Your Wallet Passphrase

Pick a strong passphrase now and add it to `.env`. This encrypts your user key — **if you lose it, you lose the wallet.** Write it down somewhere safe too.

```
BITGO_WALLET_PASSPHRASE=some-very-strong-passphrase-you-chose
```

---

### Step 9 — Run setupBitgo.ts

```bash
npx ts-node scripts/setupBitgo.ts
```

This script does everything in one run:
1. Creates the BitGo MPC key set (BitGo key + your user key + backup key)
2. Creates the MPC hot wallet on Sepolia (`teth` coin)
3. Creates the destination whitelist policy rule (configured with NO approvers so JIT updates activate instantly)
4. Creates the velocity limit policy rule
5. Registers the transfer webhook pointing at `ENGINE_URL/webhooks/bitgo`
6. Prints all the IDs you need

**Output looks like:**
```
✓ BitGo key created:    abc123
✓ User key created:     def456
✓ Backup key created:   ghi789
✓ Wallet created:       WALLET_ID=5f3a2b1c...
✓ Whitelist policy:     WHITELIST_POLICY_ID=plop-destination-whitelist
✓ Velocity policy:      VELOCITY_POLICY_ID=plop-velocity-limit
✓ Webhook created:      secret=wh_sec_xyz...
```

Copy all of these into your `.env`:
```
BITGO_WALLET_ID=5f3a2b1c...
WHITELIST_POLICY_ID=plop-destination-whitelist
VELOCITY_POLICY_ID=plop-velocity-limit
AUDIT_WEBHOOK_POLICY_ID=plop-audit-webhook
BITGO_WEBHOOK_SECRET=wh_sec_xyz...
```

---

### Step 10 — Fund the BitGo Wallet with Testnet ETH

1. In the script output from Step 9 (or in the BitGo testnet dashboard at **app.bitgo-test.com**), find your wallet's **deposit address** (the base address of the wallet itself)
2. Go to **https://sepoliafaucet.com** and drip some Sepolia ETH to that address
3. Wait ~30 seconds for confirmation
4. Verify in the BitGo dashboard: **Wallets → your wallet → balance**

You need enough to cover multiple settlements. 0.5–1 Sepolia ETH is fine for a hackathon demo.

---

## Engine + Verification

### Step 11 — Verify Everything is Wired Together

Run this quick sanity check before starting the engine:

```bash
npx ts-node scripts/verify.ts
```

This should check:
- `curl $FILEVERSE_SERVER_URL/ping` returns pong ✓
- ENS: `plop.eth` resolver == `DARK_POOL_RESOLVER_ADDRESS` ✓
- BitGo: wallet exists and has balance ✓
- BitGo: whitelist + velocity policies exist ✓

If anything fails, go back to the relevant step.

---

### Step 12 — Start the Engine

```bash
npm run engine
```

On startup the engine will:
1. Paginate `GET /api/ddocs` from Fileverse to load any existing live orders
2. Skip any orders in `IN_SETTLEMENT` or `PARTIALLY_FILLED_IN_SETTLEMENT` (flag for manual review)
3. Verify Fileverse server is reachable
4. Verify BitGo wallet balance
5. Start the 15-second polling loop
6. Start the Express webhook server on `ENGINE_PORT`

**You should see:**
```
[Startup] Fileverse OK
[Startup] BitGo wallet balance: 500000000000000000 wei
[Startup] 0 live orders loaded
[Engine] Polling loop started (15s interval)
[Webhooks] Express server listening on port 3001
```

---

## Frontend Wiring (Lovable)

### Step 13 — Give the Frontend Its Config

The frontend needs these values hardcoded or in its env:

```
NEXT_PUBLIC_ENGINE_URL=http://localhost:3001         # or your deployed engine URL
NEXT_PUBLIC_ENGINE_PUBLIC_KEY=<base64 NaCl public key>  # from your engine keypair
NEXT_PUBLIC_DARK_POOL_RESOLVER=0x4a3F8b...           # DARK_POOL_RESOLVER_ADDRESS
NEXT_PUBLIC_ETH_SEPOLIA_RPC=https://sepolia.infura.io/v3/YOUR_KEY
```

The NaCl engine keypair is generated once:
```typescript
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';

const keypair = nacl.box.keyPair();
console.log('Public key:', encodeBase64(keypair.publicKey));   // → NEXT_PUBLIC_ENGINE_PUBLIC_KEY
console.log('Secret key:', encodeBase64(keypair.secretKey));   // → ENGINE_SECRET_KEY in .env (never expose)
```

Run this once, save both. The public key goes to the frontend. The secret key stays in your engine `.env` as `ENGINE_SECRET_KEY`.

---

## Full `.env` When Done

```bash
# ── Ethereum Sepolia ────────────────────────────────────────────────────────
ETH_SEPOLIA_RPC=https://sepolia.infura.io/v3/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...

# ── Fileverse REST API ──────────────────────────────────────────────────────
FILEVERSE_API_KEY=fv_...
FILEVERSE_SERVER_URL=https://your-server.fileverse.io

# ── BitGo ───────────────────────────────────────────────────────────────────
BITGO_ENV=test
BITGO_ACCESS_TOKEN=v2x1a2b3...
BITGO_ENTERPRISE_ID=67a3f...
BITGO_WALLET_ID=5f3a2b1c...
BITGO_WALLET_PASSPHRASE=some-very-strong-passphrase-you-chose
BITGO_WEBHOOK_SECRET=wh_sec_xyz...

# ── Engine ───────────────────────────────────────────────────────────────────
ENGINE_PORT=3001
ENGINE_POLL_INTERVAL_MS=15000
ENGINE_URL=http://localhost:3001
ENGINE_SECRET_KEY=<base64 NaCl secret key>

# ── ENS ─────────────────────────────────────────────────────────────────────
EPOCH_SECONDS=3600
DARK_POOL_RESOLVER_ADDRESS=0x4a3F8b...

# ── Policy IDs (from setupBitgo.ts output) ───────────────────────────────────
WHITELIST_POLICY_ID=plop-destination-whitelist
VELOCITY_POLICY_ID=plop-velocity-limit
AUDIT_WEBHOOK_POLICY_ID=plop-audit-webhook
```

---

## Deployment Order Summary

| # | What | Script / Action | Output you copy to `.env` |
|---|------|-----------------|--------------------------|
| 1 | BitGo account | Manual at app.bitgo-test.com | `BITGO_ACCESS_TOKEN`, `BITGO_ENTERPRISE_ID` |
| 2 | Fileverse account | Manual at ddocs.new | `FILEVERSE_API_KEY`, `FILEVERSE_SERVER_URL` |
| 3 | Register plop.eth | Manual at sepolia.app.ens.domains | `DEPLOYER_PRIVATE_KEY` |
| 4 | Clone + install | `npm install` | — |
| 5 | Compile contracts | `npx hardhat compile` | — |
| 6 | Deploy resolver | `npx ts-node scripts/deployResolver.ts` | `DARK_POOL_RESOLVER_ADDRESS` |
| 7 | Point ENS at resolver | Manual at sepolia.app.ens.domains | — |
| 8 | Choose passphrase | Manual | `BITGO_WALLET_PASSPHRASE` |
| 9 | Create BitGo wallet + policies | `npx ts-node scripts/setupBitgo.ts` | `BITGO_WALLET_ID`, `WHITELIST_POLICY_ID`, `VELOCITY_POLICY_ID`, `AUDIT_WEBHOOK_POLICY_ID`, `BITGO_WEBHOOK_SECRET` |
| 10 | Fund BitGo wallet | Manual at sepoliafaucet.com | — |
| 11 | Verify wiring | `npx ts-node scripts/verify.ts` | — |
| 12 | Start engine | `npm run engine` | — |
| 13 | Wire frontend | Paste keys into Lovable env | — |

---

## Common Mistakes

**"My ENS subname resolves to the zero address"** → You forgot Step 7 — plop.eth is still pointing at the default resolver, not yours. Go to sepolia.app.ens.domains and set the resolver to `DARK_POOL_RESOLVER_ADDRESS`.

**"BitGo send fails with policy error"** → The whitelist policy has approvers set. Check the BitGo dashboard → your wallet → Policies → whitelist rule → make sure no approvers are configured. If there are, recreate the rule without them.

**"Fileverse sync is stuck on pending"** → Normal for up to 30 seconds. If it's been over 60s, call `GET /api/ddocs/:ddocId` and check `syncStatus`. If it's `failed`, hit the retry endpoint.

**"Engine starts but finds 0 orders after a crash"** → Expected — the engine rebuilds from Fileverse via `listDocs()` on startup. If orders are missing, check their `syncStatus` in the Fileverse dashboard at ddocs.new.

**"setupBitgo.ts fails on wallet creation"** → Make sure you're using `generateMPCKeys()` flow (keychains → wallets.add), NOT `generateWallet()`. The latter is for multisig only. Also make sure you're authenticated with a valid `BITGO_ACCESS_TOKEN`.
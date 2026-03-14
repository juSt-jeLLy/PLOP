import 'dotenv/config';
import nacl from 'tweetnacl';
import { createHmac, randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseEther, toBytes } from 'viem';
import { sepolia } from 'viem/chains';
import { namehash, normalize } from 'viem/ens';
import { privateKeyToAccount } from 'viem/accounts';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function encodeBase64(value) {
  return Buffer.from(value).toString('base64');
}

function decodeBase64(value) {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function randomAddress() {
  return `0x${randomBytes(20).toString('hex')}`;
}

function randomHex32() {
  return `0x${randomBytes(32).toString('hex')}`;
}
function isTruthy(value) {
  return ['1', 'true', 'yes'].includes((value || '').toLowerCase());
}

function shouldSimulateWebhook() {
  if (isTruthy(process.env.SMOKE_SIMULATE_WEBHOOK)) return true;
  if (isTruthy(process.env.SMOKE_FORCE_WEBHOOK)) return true; // backward compat
  return false;
}

function getFundingKey() {
  return process.env.HOODI_FUNDING_PRIVATE_KEY
    || process.env.ENGINE_PRIVATE_KEY
    || process.env.DEPLOYER_PRIVATE_KEY;
}

function getHoodiChain(rpcUrl) {
  return defineChain({
    id: 560048,
    name: 'Hoodi',
    nativeCurrency: { name: 'Hoodi ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
}

async function sendDeposit(address, amountEth) {
  const rpcUrl = requireEnv('ETH_HOODI_RPC');
  const privateKey = getFundingKey();
  if (!privateKey) {
    throw new Error('[Config] Missing HOODI_FUNDING_PRIVATE_KEY or ENGINE_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY');
  }

  const chain = getHoodiChain(rpcUrl);
  const account = privateKeyToAccount(privateKey);
  console.log('[Smoke] Hoodi funding wallet:', account.address);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const hash = await walletClient.sendTransaction({
    to: address,
    value: parseEther(amountEth),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function simulateWebhookConfirm(engineUrl, depositAddress) {
  const webhookPayload = {
    type: 'transfer',
    state: 'confirmed',
    transfer: { state: 'confirmed', entries: [{ address: depositAddress }] },
  };

  const signed = signWebhookPayload(webhookPayload);
  await fetchJson(`${engineUrl}/webhooks/bitgo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signed ? { 'x-signature-sha256': signed.signature } : {}),
    },
    body: signed ? signed.body : JSON.stringify(webhookPayload),
  });
}

function buildEncryptedSettlementPayload(payload, enginePublicKeyB64) {
  const enginePublicKey = decodeBase64(enginePublicKeyB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ephemeral = nacl.box.keyPair();
  const encrypted = nacl.box(
    Buffer.from(JSON.stringify(payload), 'utf8'),
    nonce,
    enginePublicKey,
    ephemeral.secretKey
  );
  const envelope = {
    encryptedB64: encodeBase64(encrypted),
    nonceB64: encodeBase64(nonce),
    ephemeralPublicKeyB64: encodeBase64(ephemeral.publicKey),
  };
  return `plop:v1:${Buffer.from(JSON.stringify(envelope)).toString('base64')}`;
}

async function submitSettlementAuthorization(engineUrl, subname, enginePublicKeyB64) {
  const controllerAddress = process.env.SETTLEMENT_CONTROLLER_ADDRESS;
  if (!controllerAddress) return;

  const signerKey =
    process.env.SETTLEMENT_SIGNER_PRIVATE_KEY ||
    process.env.HOODI_FUNDING_PRIVATE_KEY ||
    process.env.ENGINE_PRIVATE_KEY ||
    process.env.DEPLOYER_PRIVATE_KEY;

  if (!signerKey) {
    throw new Error('[Config] Missing SETTLEMENT_SIGNER_PRIVATE_KEY for settlement authorization');
  }

  const signer = privateKeyToAccount(signerKey);
  const nonce = randomHex32();
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const payload = buildEncryptedSettlementPayload(
    {
      recipient: signer.address,
      chainId: 560048,
      expiry,
      nonce,
    },
    enginePublicKeyB64
  );

  const payloadHash = keccak256(toBytes(payload));
  const node = namehash(normalize(subname));

  const walletClient = createWalletClient({ account: signer, chain: sepolia, transport: http(requireEnv('ETH_SEPOLIA_RPC')) });
  const signature = await walletClient.signTypedData({
    account: signer,
    domain: {
      name: 'PlopSettlementController',
      version: '1',
      chainId: sepolia.id,
      verifyingContract: controllerAddress,
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
      expiry: BigInt(expiry),
      nonce,
    },
  });

  await fetchJson(`${engineUrl}/session/settlement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ensSubname: subname,
      payload,
      expiry,
      nonce,
      signature,
    }),
  });
}

function requireSafeRecipient(useRealDeposit) {
  if (!useRealDeposit) return;
  if (process.env.ENGINE_TEST_RECIPIENT) return;
  if (isTruthy(process.env.SMOKE_ALLOW_DERIVED_RECIPIENT)) {
    console.warn('[Smoke] ENGINE_TEST_RECIPIENT not set; settlement may go to derived ENS address.');
    return;
  }
  throw new Error('[Smoke] ENGINE_TEST_RECIPIENT not set. Set it or SMOKE_ALLOW_DERIVED_RECIPIENT=1 to proceed.');
}

function fileverseUrl(path, params = {}) {
  const server = requireEnv('FILEVERSE_SERVER_URL').replace(/\/+$/, '');
  const apiKey = requireEnv('FILEVERSE_API_KEY');
  const url = new URL(`${server}${path}`);
  url.searchParams.set('apiKey', apiKey);
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null) url.searchParams.set(key, String(val));
  });
  return url.toString();
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

function signWebhookPayload(payload) {
  const secret = process.env.BITGO_WEBHOOK_SECRET;
  if (!secret) return null;
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return { body, signature: `sha256=${signature}` };
}

async function getDoc(ddocId) {
  return fetchJson(fileverseUrl(`/api/ddocs/${ddocId}`));
}

async function deleteDoc(ddocId) {
  if (['1', 'true', 'yes'].includes((process.env.FILEVERSE_SKIP_DELETE || '').toLowerCase())) {
    return;
  }
  await fetchJson(fileverseUrl(`/api/ddocs/${ddocId}`), { method: 'DELETE' });
}

async function waitForSync(ddocId, timeoutMs = 60000) {
  if (['1', 'true', 'yes'].includes((process.env.FILEVERSE_SKIP_SYNC || '').toLowerCase())) {
    return null;
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const doc = await getDoc(ddocId);
    if (doc?.syncStatus === 'synced') return doc.link;
    if (doc?.syncStatus === 'failed') throw new Error(`[Fileverse] Sync failed for ${ddocId}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`[Fileverse] Sync timeout for ${ddocId}`);
}

async function waitForStatus(ddocId, expected, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const doc = await getDoc(ddocId);
    if (doc?.content) {
      const parsed = JSON.parse(doc.content);
      if (parsed?.status === 'SETTLEMENT_FAILED' || parsed?.status === 'PARTIAL_SETTLEMENT') {
        throw new Error(`[Smoke] Settlement failed for ${ddocId}: ${parsed.status}`);
      }
      if (expected.includes(parsed?.status)) return parsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`[Smoke] Timeout waiting for ${expected.join(',')}`);
}

async function waitForEnsText(ensClient, name, key, predicate, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await ensClient.getEnsText({ name: normalize(name), key });
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`[Smoke] Timeout waiting for ENS text ${key}`);
}

async function createOrder({
  subname,
  depositAddress,
  traderKeypair,
  type,
  amountWei,
  limitPrice,
}) {
  const enginePublicKey = decodeBase64(requireEnv('ENGINE_PUBLIC_KEY'));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const payload = {
    tokenIn: 'ETH',
    tokenOut: 'ETH',
    amount: amountWei,
    limitPrice,
    ttlSeconds: 3600,
    type,
    traderPublicKey: encodeBase64(traderKeypair.publicKey),
    depositAddress,
    sessionSubname: subname,
  };

  const encrypted = nacl.box(
    Buffer.from(JSON.stringify(payload), 'utf8'),
    nonce,
    enginePublicKey,
    traderKeypair.secretKey
  );

  const storedOrder = {
    sessionSubname: subname,
    status: 'PENDING_DEPOSIT',
    encryptedOrder: {
      encryptedB64: encodeBase64(encrypted),
      nonceB64: encodeBase64(nonce),
      ephemeralPublicKeyB64: encodeBase64(traderKeypair.publicKey),
    },
    originalAmount: amountWei,
    remainingAmount: amountWei,
    filledAmount: '0',
    submittedAt: Date.now(),
    ttlSeconds: 3600,
    parentDdocId: null,
  };

  const createRes = await fetchJson(fileverseUrl('/api/ddocs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'order-smoke', content: JSON.stringify(storedOrder) }),
  });
  const ddocId = createRes?.data?.ddocId;
  if (!ddocId) throw new Error('[Smoke] Fileverse createDoc failed');
  const syncTimeoutMs = Number(process.env.FILEVERSE_SYNC_TIMEOUT_MS || 300000);
  await waitForSync(ddocId, syncTimeoutMs);
  return ddocId;
}

async function main() {
  const engineUrl = requireEnv('ENGINE_URL').replace(/\/+$/, '');
  const rpcUrl = requireEnv('ETH_SEPOLIA_RPC');
  const useRealDeposit = isTruthy(process.env.SMOKE_REAL_DEPOSIT);
  const depositAmountEth = process.env.SMOKE_DEPOSIT_ETH || '0.01';
  const simulateWebhook = shouldSimulateWebhook();
  requireSafeRecipient(useRealDeposit);
  const skipSync = ['1', 'true', 'yes'].includes((process.env.FILEVERSE_SKIP_SYNC || '').toLowerCase());
  const skipReceipts = skipSync
    || ['1', 'true', 'yes'].includes((process.env.SMOKE_SKIP_RECEIPTS || '').toLowerCase());

  console.log('[Smoke] Engine health check...');
  const health = await fetchJson(`${engineUrl}/health`);
  if (!health?.ok) throw new Error('[Smoke] Engine health failed');

  console.log('[Smoke] Creating sessions...');
  const sessionA = await fetchJson(`${engineUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: randomAddress(), pairs: ['ETH/ETH'] }),
  });
  const sessionB = await fetchJson(`${engineUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: randomAddress(), pairs: ['ETH/ETH'] }),
  });

  const subnameA = sessionA?.subname;
  const subnameB = sessionB?.subname;
  const depositA = sessionA?.depositAddress;
  const depositB = sessionB?.depositAddress;
  if (!subnameA || !subnameB || !depositA || !depositB) {
    throw new Error('[Smoke] Session create failed');
  }
  console.log('[Smoke] Sessions:', { subnameA, depositA, subnameB, depositB });

  if (process.env.SETTLEMENT_CONTROLLER_ADDRESS) {
    console.log('[Smoke] Submitting settlement authorizations...');
    await Promise.all([
      submitSettlementAuthorization(engineUrl, subnameA, requireEnv('ENGINE_PUBLIC_KEY')),
      submitSettlementAuthorization(engineUrl, subnameB, requireEnv('ENGINE_PUBLIC_KEY')),
    ]);
  }

  console.log('[Smoke] Verifying ENS text records...');
  const ensClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  await Promise.all([
    waitForEnsText(ensClient, subnameA, 'plop.active', (value) => value === 'true'),
    waitForEnsText(ensClient, subnameB, 'plop.active', (value) => value === 'true'),
  ]);

  console.log('[Smoke] Creating orders...');
  const traderA = nacl.box.keyPair();
  const traderB = nacl.box.keyPair();
  const amountWei = '100000000000000'; // 0.0001 ETH

  const orderA = await createOrder({
    subname: subnameA,
    depositAddress: depositA,
    traderKeypair: traderA,
    type: 'SELL',
    amountWei,
    limitPrice: '1',
  });
  const orderB = await createOrder({
    subname: subnameB,
    depositAddress: depositB,
    traderKeypair: traderB,
    type: 'BUY',
    amountWei,
    limitPrice: '1',
  });
  console.log('[Smoke] Orders created:', { orderA, orderB });

  if (useRealDeposit) {
    console.log('[Smoke] Sending real deposits on Hoodi...');
    const txA = await sendDeposit(depositA, depositAmountEth);
    const txB = await sendDeposit(depositB, depositAmountEth);
    console.log('[Smoke] Deposit tx hashes:', { txA, txB });

    if (simulateWebhook) {
      console.log('[Smoke] Simulating webhooks (local engine detected)...');
      await Promise.all([
        simulateWebhookConfirm(engineUrl, depositA),
        simulateWebhookConfirm(engineUrl, depositB),
      ]);
    }

    console.log('[Smoke] Waiting for orders to go LIVE...');
    const liveStatuses = [
      'LIVE',
      'IN_SETTLEMENT',
      'PARTIALLY_FILLED_IN_SETTLEMENT',
      'MATCHED',
      'PARTIALLY_FILLED',
    ];
    await Promise.all([
      waitForStatus(orderA, liveStatuses),
      waitForStatus(orderB, liveStatuses),
    ]);
  } else {
    console.log('[Smoke] Simulating BitGo webhook confirms...');
    await Promise.all([
      simulateWebhookConfirm(engineUrl, depositA),
      simulateWebhookConfirm(engineUrl, depositB),
    ]);
  }

  console.log('[Smoke] Waiting for settlement...');
  const [finalA, finalB] = await Promise.all([
    waitForStatus(orderA, ['MATCHED', 'PARTIALLY_FILLED']),
    waitForStatus(orderB, ['MATCHED', 'PARTIALLY_FILLED']),
  ]);

  console.log('[Smoke] Orders settled:', {
    orderA: finalA.status,
    orderB: finalB.status,
  });

  console.log('[Smoke] Checking receipts text records...');
  if (skipReceipts) {
    console.log('[Smoke] Skipping receipts check (sync disabled)');
  } else {
    await Promise.all([
      waitForEnsText(ensClient, subnameA, 'plop.receipts', (value) => Boolean(value)),
      waitForEnsText(ensClient, subnameB, 'plop.receipts', (value) => Boolean(value)),
    ]);
  }

  console.log('[Smoke] Cleaning up test orders...');
  await deleteDoc(orderA);
  await deleteDoc(orderB);
  console.log('[Smoke] Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

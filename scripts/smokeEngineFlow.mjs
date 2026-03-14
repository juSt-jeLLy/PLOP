import 'dotenv/config';
import { createHmac, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
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
    transfer: {
      state: 'confirmed',
      entries: [{ address: depositAddress }],
    },
  };

  const secret = process.env.BITGO_WEBHOOK_SECRET;
  const rawBody = JSON.stringify(webhookPayload);
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
    headers['x-signature'] = `sha256=${digest}`;
  }

  await fetchJson(`${engineUrl}/webhooks/bitgo`, {
    method: 'POST',
    headers,
    body: rawBody,
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

async function getDoc(ddocId) {
  return fetchJson(fileverseUrl(`/api/ddocs/${ddocId}`));
}

async function deleteDoc(ddocId) {
  await fetchJson(fileverseUrl(`/api/ddocs/${ddocId}`), { method: 'DELETE' });
}

async function main() {
  const engineUrl = requireEnv('ENGINE_URL').replace(/\/+$/, '');
  const enginePublicKeyB64 = requireEnv('ENGINE_PUBLIC_KEY');
  const engineAddress = requireEnv('ENGINE_ADDRESS');
  const useRealDeposit = isTruthy(process.env.SMOKE_REAL_DEPOSIT);
  const depositAmountEth = process.env.SMOKE_DEPOSIT_ETH || '0.01';
  const simulateWebhook = shouldSimulateWebhook();

  console.log('[Smoke] Engine health check...');
  const health = await fetchJson(`${engineUrl}/health`);
  if (!health?.ok) throw new Error('[Smoke] Engine health failed');

  console.log('[Smoke] Creating ENS session via engine...');
  const sessionRes = await fetchJson(`${engineUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: engineAddress,
      pairs: ['ETH/ETH'],
    }),
  });

  const subname = sessionRes?.subname;
  const depositAddress = sessionRes?.depositAddress;
  if (!subname || !depositAddress) throw new Error('[Smoke] Session response invalid');
  console.log('[Smoke] Session created:', { subname, depositAddress });

  if (process.env.SETTLEMENT_CONTROLLER_ADDRESS) {
    console.log('[Smoke] Submitting settlement authorization...');
    await submitSettlementAuthorization(engineUrl, subname, enginePublicKeyB64);
  }

  console.log('[Smoke] Verifying ENS text records...');
  const client = createPublicClient({ chain: sepolia, transport: http(requireEnv('ETH_SEPOLIA_RPC')) });
  const active = await client.getEnsText({ name: normalize(subname), key: 'plop.active' });
  const pairs = await client.getEnsText({ name: normalize(subname), key: 'plop.pairs' });
  const settlement = await client.getEnsText({ name: normalize(subname), key: 'plop.settlement' });

  if (active !== 'true') throw new Error('[Smoke] ENS plop.active not set');
  if (pairs !== 'ETH/ETH') throw new Error('[Smoke] ENS plop.pairs mismatch');
  if (!settlement || !settlement.startsWith('plop:v1:')) {
    throw new Error('[Smoke] ENS plop.settlement missing or malformed');
  }

  console.log('[Smoke] Creating Fileverse order (PENDING_DEPOSIT)...');
  const traderKeypair = nacl.box.keyPair();
  const orderPayload = {
    tokenIn: 'ETH',
    tokenOut: 'ETH',
    amount: '10000000000000000',
    limitPrice: '1',
    ttlSeconds: 3600,
    type: 'SELL',
    traderPublicKey: encodeBase64(traderKeypair.publicKey),
    depositAddress,
    sessionSubname: subname,
  };

  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const enginePublicKey = decodeBase64(enginePublicKeyB64);
  const encrypted = nacl.box(
    Buffer.from(JSON.stringify(orderPayload), 'utf8'),
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
    originalAmount: orderPayload.amount,
    remainingAmount: orderPayload.amount,
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
  console.log('[Smoke] Order created:', ddocId);

  if (useRealDeposit) {
    console.log('[Smoke] Sending real deposit on Hoodi...');
    const txHash = await sendDeposit(depositAddress, depositAmountEth);
    console.log('[Smoke] Deposit tx hash:', txHash);
    if (simulateWebhook) {
      console.log('[Smoke] Simulating webhook (local engine detected)...');
      await simulateWebhookConfirm(engineUrl, depositAddress);
    }
  } else {
    console.log('[Smoke] Simulating BitGo webhook confirm...');
    await simulateWebhookConfirm(engineUrl, depositAddress);
  }

  let status = null;
  const liveStatuses = new Set([
    'LIVE',
    'IN_SETTLEMENT',
    'PARTIALLY_FILLED_IN_SETTLEMENT',
    'MATCHED',
    'PARTIALLY_FILLED',
  ]);
  const maxAttempts = useRealDeposit ? 60 : 5;
  const sleepMs = useRealDeposit ? 5000 : 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const doc = await getDoc(ddocId);
    if (doc?.content) {
      const parsed = JSON.parse(doc.content);
      status = parsed?.status;
      if (liveStatuses.has(status)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }

  if (!liveStatuses.has(status)) {
    throw new Error('[Smoke] Order did not transition to LIVE after deposit/webhook');
  }
  console.log('[Smoke] Order status is LIVE');

  console.log('[Smoke] Cleaning up test order...');
  await deleteDoc(ddocId);
  console.log('[Smoke] Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

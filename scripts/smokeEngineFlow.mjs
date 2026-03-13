import 'dotenv/config';
import { createHmac } from 'node:crypto';
import nacl from 'tweetnacl';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

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

  console.log('[Smoke] Verifying ENS text records...');
  const client = createPublicClient({ chain: sepolia, transport: http(requireEnv('ETH_SEPOLIA_RPC')) });
  const active = await client.getEnsText({ name: normalize(subname), key: 'plop.active' });
  const deposit = await client.getEnsText({ name: normalize(subname), key: 'plop.deposit' });
  const pairs = await client.getEnsText({ name: normalize(subname), key: 'plop.pairs' });

  if (active !== 'true') throw new Error('[Smoke] ENS plop.active not set');
  if (deposit?.toLowerCase() !== depositAddress.toLowerCase()) {
    throw new Error('[Smoke] ENS plop.deposit mismatch');
  }
  if (pairs !== 'ETH/ETH') throw new Error('[Smoke] ENS plop.pairs mismatch');

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
    depositAddress,
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

  console.log('[Smoke] Simulating BitGo webhook confirm...');
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

  let status = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const doc = await getDoc(ddocId);
    if (doc?.content) {
      const parsed = JSON.parse(doc.content);
      status = parsed?.status;
      if (status === 'LIVE') break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (status !== 'LIVE') {
    throw new Error('[Smoke] Order did not transition to LIVE after webhook');
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

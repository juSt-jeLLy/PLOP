import 'dotenv/config';
import nacl from 'tweetnacl';
import { createHmac, randomBytes } from 'node:crypto';
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

function signWebhookPayload(payload) {
  const secret = process.env.BITGO_WEBHOOK_SECRET;
  if (!secret) return null;
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return { body, signature: `sha256=${signature}` };
}

function randomAddress() {
  return `0x${randomBytes(20).toString('hex')}`;
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
    depositAddress,
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

async function findResidualOrder(parentId) {
  let skip = 0;
  const limit = 50;
  while (true) {
    const res = await fetchJson(fileverseUrl('/api/ddocs', { limit, skip }));
    const ddocs = res?.ddocs || [];
    for (const doc of ddocs) {
      if (!doc?.content) continue;
      try {
        const parsed = JSON.parse(doc.content);
        if (parsed?.parentDdocId === parentId && parsed?.status === 'LIVE') {
          return doc.ddocId;
        }
      } catch {
        continue;
      }
    }
    if (!res?.hasNext) break;
    skip += limit;
  }
  return null;
}

async function main() {
  const engineUrl = requireEnv('ENGINE_URL').replace(/\/+$/, '');
  const rpcUrl = requireEnv('ETH_SEPOLIA_RPC');
  const skipSync = ['1', 'true', 'yes'].includes((process.env.FILEVERSE_SKIP_SYNC || '').toLowerCase());

  console.log('[Partial Smoke] Engine health check...');
  const health = await fetchJson(`${engineUrl}/health`);
  if (!health?.ok) throw new Error('[Partial Smoke] Engine health failed');

  console.log('[Partial Smoke] Creating sessions...');
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
    throw new Error('[Partial Smoke] Session create failed');
  }

  console.log('[Partial Smoke] Verifying ENS text records...');
  const ensClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  await Promise.all([
    waitForEnsText(ensClient, subnameA, 'plop.active', (value) => value === 'true'),
    waitForEnsText(ensClient, subnameB, 'plop.active', (value) => value === 'true'),
  ]);

  console.log('[Partial Smoke] Creating orders (unequal amounts)...');
  const traderA = nacl.box.keyPair();
  const traderB = nacl.box.keyPair();
  const amountA = '200000000000000'; // 0.0002 ETH
  const amountB = '100000000000000'; // 0.0001 ETH

  const orderA = await createOrder({
    subname: subnameA,
    depositAddress: depositA,
    traderKeypair: traderA,
    type: 'SELL',
    amountWei: amountA,
    limitPrice: '1',
  });
  const orderB = await createOrder({
    subname: subnameB,
    depositAddress: depositB,
    traderKeypair: traderB,
    type: 'BUY',
    amountWei: amountB,
    limitPrice: '1',
  });

  console.log('[Partial Smoke] Simulating BitGo webhook confirms...');
  const webhookPayload = (address) => ({
    type: 'transfer',
    state: 'confirmed',
    transfer: { state: 'confirmed', entries: [{ address }] },
  });

  const payloadA = webhookPayload(depositA);
  const signedA = signWebhookPayload(payloadA);
  await fetchJson(`${engineUrl}/webhooks/bitgo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signedA ? { 'x-signature-sha256': signedA.signature } : {}),
    },
    body: signedA ? signedA.body : JSON.stringify(payloadA),
  });

  const payloadB = webhookPayload(depositB);
  const signedB = signWebhookPayload(payloadB);
  await fetchJson(`${engineUrl}/webhooks/bitgo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signedB ? { 'x-signature-sha256': signedB.signature } : {}),
    },
    body: signedB ? signedB.body : JSON.stringify(payloadB),
  });

  console.log('[Partial Smoke] Waiting for settlement...');
  const [finalA, finalB] = await Promise.all([
    waitForStatus(orderA, ['PARTIALLY_FILLED']),
    waitForStatus(orderB, ['MATCHED']),
  ]);

  console.log('[Partial Smoke] Orders settled:', {
    orderA: finalA.status,
    orderB: finalB.status,
  });

  console.log('[Partial Smoke] Checking residual order exists...');
  const residualId = await findResidualOrder(orderA);
  if (!residualId) {
    throw new Error('[Partial Smoke] Residual order not found for partially filled order');
  }
  console.log('[Partial Smoke] Residual order:', residualId);

  console.log('[Partial Smoke] Checking ENS active flags...');
  if (!skipSync) {
    const [activeA, activeB] = await Promise.all([
      ensClient.getEnsText({ name: normalize(subnameA), key: 'plop.active' }),
      ensClient.getEnsText({ name: normalize(subnameB), key: 'plop.active' }),
    ]);
    if (activeA !== 'true') throw new Error('[Partial Smoke] Partially filled session rotated');
    if (activeB !== 'false') console.warn('[Partial Smoke] Fully filled session not rotated yet');
  }

  console.log('[Partial Smoke] Cleaning up test orders...');
  await deleteDoc(orderA);
  await deleteDoc(orderB);
  if (residualId) await deleteDoc(residualId);
  console.log('[Partial Smoke] Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

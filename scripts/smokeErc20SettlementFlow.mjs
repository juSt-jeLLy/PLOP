import 'dotenv/config';
import nacl from 'tweetnacl';
import { createHmac } from 'node:crypto';
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
  tokenIn,
  tokenOut,
}) {
  const enginePublicKey = decodeBase64(requireEnv('ENGINE_PUBLIC_KEY'));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const payload = {
    tokenIn,
    tokenOut,
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
    body: JSON.stringify({ title: 'order-erc20-smoke', content: JSON.stringify(storedOrder) }),
  });
  const ddocId = createRes?.data?.ddocId;
  if (!ddocId) throw new Error('[Smoke] Fileverse createDoc failed');
  const syncTimeoutMs = Number(process.env.FILEVERSE_SYNC_TIMEOUT_MS || 300000);
  await waitForSync(ddocId, syncTimeoutMs);
  return ddocId;
}

async function main() {
  const engineUrl = requireEnv('ENGINE_URL').replace(/\/+$/, '');
  const engineAddress = requireEnv('ENGINE_ADDRESS');
  const rpcUrl = requireEnv('ETH_SEPOLIA_RPC');
  const skipSync = ['1', 'true', 'yes'].includes((process.env.FILEVERSE_SKIP_SYNC || '').toLowerCase());
  const skipReceipts = skipSync
    || ['1', 'true', 'yes'].includes((process.env.SMOKE_SKIP_RECEIPTS || '').toLowerCase());

  const tokenIn = (process.env.SMOKE_TOKEN_IN || 'hterc18dp').trim();
  const tokenOut = (process.env.SMOKE_TOKEN_OUT || 'ETH').trim();

  console.log('[ERC20 Smoke] Engine health check...');
  const health = await fetchJson(`${engineUrl}/health`);
  if (!health?.ok) throw new Error('[ERC20 Smoke] Engine health failed');

  console.log('[ERC20 Smoke] Creating sessions...');
  const sessionA = await fetchJson(`${engineUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: engineAddress, pairs: [`${tokenIn}/${tokenOut}`] }),
  });
  const sessionB = await fetchJson(`${engineUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: engineAddress, pairs: [`${tokenOut}/${tokenIn}`] }),
  });

  const subnameA = sessionA?.subname;
  const subnameB = sessionB?.subname;
  const depositA = sessionA?.depositAddress;
  const depositB = sessionB?.depositAddress;
  if (!subnameA || !subnameB || !depositA || !depositB) {
    throw new Error('[ERC20 Smoke] Session create failed');
  }

  console.log('[ERC20 Smoke] Verifying ENS text records...');
  const ensClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  await Promise.all([
    waitForEnsText(ensClient, subnameA, 'plop.active', (value) => value === 'true'),
    waitForEnsText(ensClient, subnameB, 'plop.active', (value) => value === 'true'),
  ]);

  console.log(`[ERC20 Smoke] Creating orders (${tokenIn} <-> ${tokenOut})...`);
  const traderA = nacl.box.keyPair();
  const traderB = nacl.box.keyPair();
  const amountWei = '100000000000000'; // 0.0001 (18 decimals)

  const orderA = await createOrder({
    subname: subnameA,
    depositAddress: depositA,
    traderKeypair: traderA,
    type: 'SELL',
    amountWei,
    limitPrice: '1',
    tokenIn,
    tokenOut,
  });
  const orderB = await createOrder({
    subname: subnameB,
    depositAddress: depositB,
    traderKeypair: traderB,
    type: 'BUY',
    amountWei,
    limitPrice: '1',
    tokenIn: tokenOut,
    tokenOut: tokenIn,
  });

  console.log('[ERC20 Smoke] Simulating BitGo webhook confirms...');
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

  console.log('[ERC20 Smoke] Waiting for settlement...');
  const [finalA, finalB] = await Promise.all([
    waitForStatus(orderA, ['MATCHED', 'PARTIALLY_FILLED']),
    waitForStatus(orderB, ['MATCHED', 'PARTIALLY_FILLED']),
  ]);

  console.log('[ERC20 Smoke] Orders settled:', {
    orderA: finalA.status,
    orderB: finalB.status,
  });

  console.log('[ERC20 Smoke] Checking receipts text records...');
  if (skipReceipts) {
    console.log('[ERC20 Smoke] Skipping receipts check (sync disabled)');
  } else {
    await Promise.all([
      waitForEnsText(ensClient, subnameA, 'plop.receipts', (value) => Boolean(value)),
      waitForEnsText(ensClient, subnameB, 'plop.receipts', (value) => Boolean(value)),
    ]);
  }

  console.log('[ERC20 Smoke] Cleaning up test orders...');
  await deleteDoc(orderA);
  await deleteDoc(orderB);
  console.log('[ERC20 Smoke] Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

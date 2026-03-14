import 'dotenv/config';
import nacl from 'tweetnacl';
import { createHmac, randomBytes } from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  parseEther,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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

function randomAddress() {
  return `0x${randomBytes(20).toString('hex')}`;
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
    id: Number(process.env.HOODI_CHAIN_ID || 560048),
    name: 'Hoodi',
    nativeCurrency: { name: 'Hoodi ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
}

function shouldWaitReceipt() {
  if (process.env.SMOKE_WAIT_RECEIPT === undefined) return true;
  return isTruthy(process.env.SMOKE_WAIT_RECEIPT);
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

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
const NATIVE_TOKENS = new Set(['eth', 'hteth']);

function normalizeToken(token) {
  return token.trim().toLowerCase();
}

function getHoodiClients() {
  const rpcUrl = requireEnv('ETH_HOODI_RPC');
  const privateKey = getFundingKey();
  if (!privateKey) {
    throw new Error('[Config] Missing HOODI_FUNDING_PRIVATE_KEY or ENGINE_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY');
  }
  const chain = getHoodiChain(rpcUrl);
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  return { walletClient, publicClient, account };
}

function getTokenAddressMap() {
  const raw = process.env.TOKEN_ADDRESS_MAP || process.env.VITE_TOKEN_ADDRESS_MAP;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return Object.entries(parsed).reduce((acc, [key, value]) => {
      acc[normalizeToken(key)] = value;
      return acc;
    }, {});
  } catch {
    throw new Error('[ERC20 Smoke] Failed to parse token address map');
  }
}

function getTokenDecimalsMap() {
  const raw = process.env.TOKEN_DECIMALS || process.env.VITE_TOKEN_DECIMALS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return Object.entries(parsed).reduce((acc, [key, value]) => {
      acc[normalizeToken(key)] = Number(value);
      return acc;
    }, {});
  } catch {
    throw new Error('[ERC20 Smoke] Failed to parse token decimals map');
  }
}

function resolveTokenAddress(token) {
  const map = getTokenAddressMap();
  return map[normalizeToken(token)];
}

function getTokenDecimals(token) {
  const map = getTokenDecimalsMap();
  const value = map[normalizeToken(token)];
  return Number.isFinite(value) ? value : 18;
}

function getDepositAmountForToken(token, defaultAmount = '0.01') {
  const normalized = normalizeToken(token);
  if (NATIVE_TOKENS.has(normalized)) {
    if (process.env.SMOKE_DEPOSIT_WEI) return BigInt(process.env.SMOKE_DEPOSIT_WEI);
    const ethAmount = process.env.SMOKE_DEPOSIT_ETH || defaultAmount;
    return parseEther(ethAmount);
  }
  const tokenAmount = process.env.SMOKE_DEPOSIT_TOKEN || process.env.SMOKE_DEPOSIT_ETH || defaultAmount;
  return parseUnits(tokenAmount, getTokenDecimals(token));
}

async function sendEthDeposit(to, amountWei) {
  const { walletClient, publicClient, account } = getHoodiClients();
  const txHash = await walletClient.sendTransaction({ account, to, value: amountWei });
  if (shouldWaitReceipt()) {
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }
  return txHash;
}

async function sendTokenDeposit(token, to, amountWei) {
  const tokenAddress = resolveTokenAddress(token);
  if (!tokenAddress) {
    throw new Error(`[ERC20 Smoke] Missing token address for ${token}`);
  }
  const { walletClient, publicClient, account } = getHoodiClients();
  const txHash = await walletClient.writeContract({
    account,
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, amountWei],
  });
  if (shouldWaitReceipt()) {
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }
  return txHash;
}

async function sendDeposit(token, to, amountWei) {
  if (NATIVE_TOKENS.has(normalizeToken(token))) {
    return sendEthDeposit(to, amountWei);
  }
  return sendTokenDeposit(token, to, amountWei);
}

async function waitForDepositBalance(token, address, minAmount, timeoutMs = 240000) {
  const { publicClient } = getHoodiClients();
  const start = Date.now();
  const normalized = normalizeToken(token);
  const isNative = NATIVE_TOKENS.has(normalized);
  const tokenAddress = isNative ? null : resolveTokenAddress(token);

  if (!isNative && !tokenAddress) {
    throw new Error(`[ERC20 Smoke] Missing token address for ${token}`);
  }

  while (Date.now() - start < timeoutMs) {
    const balance = isNative
      ? await publicClient.getBalance({ address })
      : await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });

    if (balance >= minAmount) return balance;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`[ERC20 Smoke] Timeout waiting for ${token} deposit balance`);
}

function signWebhookPayload(payload) {
  const secret = process.env.BITGO_WEBHOOK_SECRET;
  if (!secret) return null;
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return { body, signature: `sha256=${signature}` };
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

function requireSafeRecipient(useRealDeposit) {
  if (!useRealDeposit) return;
  if (process.env.ENGINE_TEST_RECIPIENT) return;
  if (isTruthy(process.env.SMOKE_ALLOW_DERIVED_RECIPIENT)) {
    console.warn('[ERC20 Smoke] ENGINE_TEST_RECIPIENT not set; settlement may go to derived ENS address.');
    return;
  }
  throw new Error('[ERC20 Smoke] ENGINE_TEST_RECIPIENT not set. Set it or SMOKE_ALLOW_DERIVED_RECIPIENT=1 to proceed.');
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
  const rpcUrl = requireEnv('ETH_SEPOLIA_RPC');
  const useRealDeposit = isTruthy(process.env.SMOKE_REAL_DEPOSIT);
  const simulateWebhook = shouldSimulateWebhook();
  requireSafeRecipient(useRealDeposit);
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
    body: JSON.stringify({ walletAddress: randomAddress(), pairs: [`${tokenIn}/${tokenOut}`] }),
  });
  const sessionB = await fetchJson(`${engineUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: randomAddress(), pairs: [`${tokenOut}/${tokenIn}`] }),
  });

  const subnameA = sessionA?.subname;
  const subnameB = sessionB?.subname;
  const depositA = sessionA?.depositAddress;
  const depositB = sessionB?.depositAddress;
  if (!subnameA || !subnameB || !depositA || !depositB) {
    throw new Error('[ERC20 Smoke] Session create failed');
  }
  console.log('[ERC20 Smoke] Sessions:', { subnameA, depositA, subnameB, depositB });

  console.log('[ERC20 Smoke] Verifying ENS text records...');
  const ensClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  await Promise.all([
    waitForEnsText(ensClient, subnameA, 'plop.active', (value) => value === 'true'),
    waitForEnsText(ensClient, subnameB, 'plop.active', (value) => value === 'true'),
  ]);

  console.log(`[ERC20 Smoke] Creating orders (${tokenIn} <-> ${tokenOut})...`);
  const traderA = nacl.box.keyPair();
  const traderB = nacl.box.keyPair();
  const amountWeiA = getDepositAmountForToken(tokenIn).toString();
  const amountWeiB = getDepositAmountForToken(tokenOut).toString();

  const orderA = await createOrder({
    subname: subnameA,
    depositAddress: depositA,
    traderKeypair: traderA,
    type: 'SELL',
    amountWei: amountWeiA,
    limitPrice: '1',
    tokenIn,
    tokenOut,
  });
  const orderB = await createOrder({
    subname: subnameB,
    depositAddress: depositB,
    traderKeypair: traderB,
    type: 'BUY',
    amountWei: amountWeiB,
    limitPrice: '1',
    tokenIn: tokenOut,
    tokenOut: tokenIn,
  });
  console.log('[ERC20 Smoke] Orders created:', { orderA, orderB });

  if (useRealDeposit) {
    const { account } = getHoodiClients();
    console.log('[ERC20 Smoke] Sending real deposits on Hoodi...');
    console.log('[ERC20 Smoke] Hoodi funding wallet:', account.address);
    const txA = await sendDeposit(tokenIn, depositA, BigInt(amountWeiA));
    const txB = await sendDeposit(tokenOut, depositB, BigInt(amountWeiB));
    console.log('[ERC20 Smoke] Deposit tx hashes:', { txA, txB });
    await waitForDepositBalance(tokenIn, depositA, BigInt(amountWeiA));
    await waitForDepositBalance(tokenOut, depositB, BigInt(amountWeiB));

    if (simulateWebhook) {
      console.log('[ERC20 Smoke] Simulating webhooks (local engine detected)...');
      await Promise.all([
        simulateWebhookConfirm(engineUrl, depositA),
        simulateWebhookConfirm(engineUrl, depositB),
      ]);
    }

    console.log('[ERC20 Smoke] Waiting for orders to go LIVE...');
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
    console.log('[ERC20 Smoke] Simulating BitGo webhook confirms...');
    await Promise.all([
      simulateWebhookConfirm(engineUrl, depositA),
      simulateWebhookConfirm(engineUrl, depositB),
    ]);
  }

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

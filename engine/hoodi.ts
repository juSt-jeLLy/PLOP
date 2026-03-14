import { createPublicClient, http, parseAbi, parseUnits } from 'viem';

import type { OrderPayload, OrderStatus, StoredOrder } from '../types';
import { decryptOrderPayload } from './crypto.js';
import { listDocs, updateDoc } from './orders.js';
import { getTextRecord } from './session.js';

const PAGE_LIMIT = 50;
const NATIVE_TOKENS = new Set(['eth', 'hteth', 'teth']);
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
]);

type TokenAddressMap = Record<string, `0x${string}`>;
type TokenDecimalsMap = Record<string, number>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

// ── Token address map ────────────────────────────────────────────────────────

let tokenAddressMap: TokenAddressMap | null = null;
function getTokenAddressMap(): TokenAddressMap {
  if (tokenAddressMap) return tokenAddressMap;
  const raw = process.env.TOKEN_ADDRESS_MAP ?? process.env.VITE_TOKEN_ADDRESS_MAP;
  if (!raw) {
    tokenAddressMap = {};
    return tokenAddressMap;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    tokenAddressMap = Object.entries(parsed).reduce<TokenAddressMap>((acc, [key, value]) => {
      acc[normalizeToken(key)] = value as `0x${string}`;
      return acc;
    }, {});
  } catch (err) {
    console.warn('[Hoodi] Failed to parse TOKEN_ADDRESS_MAP; ERC-20 deposits disabled.', err);
    tokenAddressMap = {};
  }
  return tokenAddressMap;
}

// ── Token decimals map ───────────────────────────────────────────────────────

let tokenDecimalsMap: TokenDecimalsMap | null = null;
function getTokenDecimalsMap(): TokenDecimalsMap {
  if (tokenDecimalsMap) return tokenDecimalsMap;
  const raw = process.env.TOKEN_DECIMALS ?? process.env.VITE_TOKEN_DECIMALS;
  if (!raw) {
    tokenDecimalsMap = {};
    return tokenDecimalsMap;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, number | string>;
    tokenDecimalsMap = Object.entries(parsed).reduce<TokenDecimalsMap>((acc, [key, value]) => {
      const n = typeof value === 'string' ? Number(value) : value;
      acc[normalizeToken(key)] = Number.isFinite(n) ? n : 18;
      return acc;
    }, {});
  } catch (err) {
    console.warn('[Hoodi] Failed to parse TOKEN_DECIMALS; defaulting to 18.', err);
    tokenDecimalsMap = {};
  }
  return tokenDecimalsMap;
}

function resolveTokenAddress(token: string): `0x${string}` | null {
  return getTokenAddressMap()[normalizeToken(token)] ?? null;
}

function resolveTokenDecimals(token: string): number {
  const value = getTokenDecimalsMap()[normalizeToken(token)];
  return Number.isFinite(value) ? value : 18;
}

// ── Viem client ──────────────────────────────────────────────────────────────

let publicClient: ReturnType<typeof createPublicClient> | null = null;
function getPublicClient() {
  if (publicClient) return publicClient;
  const rpcUrl = process.env.ETH_HOODI_RPC;
  if (!rpcUrl) throw new Error('[Config] Missing ETH_HOODI_RPC');
  publicClient = createPublicClient({ transport: http(rpcUrl) });
  return publicClient;
}

// ── Amount parsing ───────────────────────────────────────────────────────────

function parseRequiredAmount(amount: string, token: string): bigint | null {
  const trimmed = amount.trim();
  if (!trimmed) return null;
  if (trimmed.includes('.')) {
    try {
      return parseUnits(trimmed, resolveTokenDecimals(token));
    } catch (err) {
      console.warn('[Hoodi] Failed to parse decimal amount; skipping.', err);
      return null;
    }
  }
  try {
    return BigInt(trimmed);
  } catch (err) {
    console.warn('[Hoodi] Failed to parse integer amount; skipping.', err);
    return null;
  }
}

// ── Balance check ────────────────────────────────────────────────────────────

async function getDepositBalance(token: string, address: `0x${string}`): Promise<bigint> {
  const client = getPublicClient();
  if (NATIVE_TOKENS.has(normalizeToken(token))) {
    return client.getBalance({ address });
  }
  const tokenAddress = resolveTokenAddress(token);
  if (!tokenAddress) {
    console.warn(`[Hoodi] Missing token address for ${token}; returning 0.`);
    return 0n;
  }
  return client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
}

// ── Order helpers ────────────────────────────────────────────────────────────

function isPendingDeposit(status: OrderStatus | undefined): boolean {
  return status === 'PENDING_DEPOSIT';
}

async function getOrderPayload(order: StoredOrder): Promise<OrderPayload | null> {
  try {
    return decryptOrderPayload(order.encryptedOrder);
  } catch (err) {
    console.warn('[Hoodi] Failed to decrypt order payload; skipping deposit check.', err);
    return null;
  }
}

async function markLive(ddocId: string, order: StoredOrder): Promise<void> {
  await updateDoc(
    ddocId,
    JSON.stringify({
      ...order,
      status: 'LIVE',
      depositConfirmedAt: Date.now(),
    })
  );
}

// ── Main polling loop ────────────────────────────────────────────────────────

let inFlight = false;

async function checkPendingDeposits(): Promise<void> {
  if (inFlight) return;
  inFlight = true;

  try {
    let skip = 0;

    while (true) {
      const { ddocs, hasNext } = await listDocs(PAGE_LIMIT, skip);

      for (const doc of ddocs) {
        if (!doc.ddocId || !doc.content) continue;

        let parsed: StoredOrder | null = null;
        try {
          parsed = JSON.parse(doc.content) as StoredOrder;
        } catch {
          continue;
        }

        if (!parsed || !isPendingDeposit(parsed.status)) continue;

        const payload = await getOrderPayload(parsed);
        if (!payload) continue;

        // Resolve deposit address from stored field or ENS text record
        let depositAddress = parsed.depositAddress;
        if (!depositAddress && parsed.sessionSubname) {
          depositAddress =
            (await getTextRecord(parsed.sessionSubname, 'plop.deposit')) ?? undefined;
        }
        if (!depositAddress) continue;

        const required = parseRequiredAmount(
          parsed.originalAmount || payload.amount,
          payload.tokenIn
        );
        if (!required || required <= 0n) continue;

        let balance: bigint;
        try {
          balance = await getDepositBalance(payload.tokenIn, depositAddress as `0x${string}`);
        } catch (err) {
          console.warn('[Hoodi] Failed to read deposit balance; skipping.', err);
          continue;
        }

        if (balance >= required) {
          await markLive(doc.ddocId, parsed);
          console.log('[Hoodi] Deposit confirmed, order LIVE:', doc.ddocId);
        }
      }

      if (!hasNext) break;
      skip += PAGE_LIMIT;
    }
  } finally {
    inFlight = false;
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

export function startHoodiDepositWatcher(): void {
  const enabled = parseBool(
    process.env.HOODI_DEPOSIT_WATCHER_ENABLED,
    Boolean(process.env.ETH_HOODI_RPC)
  );

  if (!enabled) {
    console.log('[Hoodi] Deposit watcher disabled (HOODI_DEPOSIT_WATCHER_ENABLED=false or ETH_HOODI_RPC not set)');
    return;
  }

  if (!process.env.ETH_HOODI_RPC) {
    console.warn('[Hoodi] ETH_HOODI_RPC missing; deposit watcher disabled.');
    return;
  }

  const intervalMs = Number(process.env.HOODI_DEPOSIT_INTERVAL_MS || 15000);
  console.log(`[Hoodi] Deposit watcher active (interval ${intervalMs}ms)`);

  // Run immediately on startup, then on interval
  checkPendingDeposits().catch((err) => {
    console.error('[Hoodi] Deposit watcher error:', err);
  });

  setInterval(() => {
    checkPendingDeposits().catch((err) => {
      console.error('[Hoodi] Deposit watcher error:', err);
    });
  }, intervalMs);
}
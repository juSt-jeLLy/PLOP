import { createPublicClient, defineChain, http, type Address } from 'viem';

import type { StoredOrder } from '../types';
import { getTextRecord } from './session.js';
import { listDocs, updateDoc } from './orders.js';

const PAGE_LIMIT = 50;
const DEFAULT_CHAIN_ID = 560048;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function getHoodiClient() {
  const rpcUrl = process.env.ETH_HOODI_RPC;
  if (!rpcUrl) return null;
  const chainId = Number(process.env.HOODI_CHAIN_ID || DEFAULT_CHAIN_ID);
  const chain = defineChain({
    id: chainId,
    name: 'Hoodi',
    nativeCurrency: { name: 'Hoodi ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

function parseOrder(doc: { content?: string | null }): StoredOrder | null {
  if (!doc.content) return null;
  try {
    return JSON.parse(doc.content) as StoredOrder;
  } catch {
    return null;
  }
}

function parseRequiredAmount(order: StoredOrder): bigint | null {
  const candidate = order.originalAmount ?? order.remainingAmount;
  if (!candidate) return null;
  try {
    return BigInt(candidate);
  } catch {
    return null;
  }
}

async function resolveDepositAddress(order: StoredOrder): Promise<Address | null> {
  if (order.depositAddress) return order.depositAddress as Address;
  if (order.sessionSubname) {
    const record = await getTextRecord(order.sessionSubname, 'plop.deposit');
    if (record) return record as Address;
  }
  return null;
}

async function checkDepositsOnce(): Promise<void> {
  const client = getHoodiClient();
  if (!client) return;

  const balanceCache = new Map<string, bigint>();
  let skip = 0;

  while (true) {
    const { ddocs, hasNext } = await listDocs(PAGE_LIMIT, skip);
    for (const doc of ddocs) {
      if (!doc.ddocId) continue;
      const parsed = parseOrder(doc);
      if (!parsed || parsed.status !== 'PENDING_DEPOSIT') continue;

      const depositAddress = await resolveDepositAddress(parsed);
      if (!depositAddress) continue;

      const required = parseRequiredAmount(parsed);
      if (required === null) continue;

      const key = depositAddress.toLowerCase();
      let balance = balanceCache.get(key);
      if (balance === undefined) {
        balance = await client.getBalance({ address: depositAddress });
        balanceCache.set(key, balance);
      }

      if (balance >= required) {
        await updateDoc(
          doc.ddocId,
          JSON.stringify({
            ...parsed,
            status: 'LIVE',
            depositConfirmedAt: Date.now(),
          })
        );
        console.log('[Hoodi] Deposit confirmed, order LIVE:', doc.ddocId);
      }
    }

    if (!hasNext) break;
    skip += PAGE_LIMIT;
  }
}

export function startHoodiDepositWatcher(): void {
  if (!process.env.ETH_HOODI_RPC) {
    console.log('[Hoodi] ETH_HOODI_RPC not set; deposit watcher disabled');
    return;
  }
  const intervalMs = Number(process.env.HOODI_DEPOSIT_POLL_MS || 15000);
  console.log(`[Hoodi] Deposit watcher active (interval ${intervalMs}ms)`);
  setInterval(() => {
    checkDepositsOnce().catch((err) => {
      console.error('[Hoodi] Deposit watcher error', err);
    });
  }, intervalMs);
  checkDepositsOnce().catch((err) => {
    console.error('[Hoodi] Deposit watcher error', err);
  });
}

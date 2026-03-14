import { namehash, normalize } from 'viem/ens';

import type {
  DecryptedOrder,
  MatchResult,
  OrderStatus,
  StoredOrder,
} from '../types';
import { decryptOrderPayload } from './crypto.js';
import { createDoc, getDoc, listDocs, updateDoc, waitForSync } from './orders.js';

const PAGE_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStoredOrder(ddocId: string, raw: unknown): StoredOrder | null {
  if (!isRecord(raw)) return null;
  const sessionSubname = typeof raw.sessionSubname === 'string'
    ? raw.sessionSubname
    : typeof raw.sessionEns === 'string'
      ? raw.sessionEns
      : null;
  if (!sessionSubname) return null;

  if (!isRecord(raw.encryptedOrder)) return null;
  const encryptedOrderRaw = raw.encryptedOrder;
  const encryptedB64 = encryptedOrderRaw.encryptedB64;
  const nonceB64 = encryptedOrderRaw.nonceB64;
  const ephemeralPublicKeyB64 = encryptedOrderRaw.ephemeralPublicKeyB64;
  if (
    typeof encryptedB64 !== 'string' ||
    typeof nonceB64 !== 'string' ||
    typeof ephemeralPublicKeyB64 !== 'string'
  ) {
    return null;
  }
  const encryptedOrder: StoredOrder['encryptedOrder'] = {
    encryptedB64,
    nonceB64,
    ephemeralPublicKeyB64,
  };

  const status = raw.status as OrderStatus | undefined;
  if (typeof status !== 'string') return null;

  if (typeof raw.originalAmount !== 'string') return null;
  if (typeof raw.remainingAmount !== 'string') return null;
  if (typeof raw.filledAmount !== 'string') return null;
  if (typeof raw.submittedAt !== 'number') return null;
  if (typeof raw.ttlSeconds !== 'number') return null;

  return {
    ddocId,
    sessionSubname,
    status,
    encryptedOrder,
    depositAddress: typeof raw.depositAddress === 'string' ? raw.depositAddress : undefined,
    originalAmount: raw.originalAmount,
    remainingAmount: raw.remainingAmount,
    filledAmount: raw.filledAmount,
    parentDdocId: typeof raw.parentDdocId === 'string' ? raw.parentDdocId : null,
    submittedAt: raw.submittedAt,
    ttlSeconds: raw.ttlSeconds,
    lastFillAt: typeof raw.lastFillAt === 'number' ? raw.lastFillAt : undefined,
    settledAt: typeof raw.settledAt === 'number' ? raw.settledAt : undefined,
    settlementTxHash: typeof raw.settlementTxHash === 'string' ? raw.settlementTxHash : undefined,
    matchedPrice: typeof raw.matchedPrice === 'number' ? raw.matchedPrice : undefined,
    counterpartyEns: typeof raw.counterpartyEns === 'string' ? raw.counterpartyEns : undefined,
  };
}

function toDecryptedOrder(order: StoredOrder): DecryptedOrder {
  const payload = decryptOrderPayload(order.encryptedOrder);
  return {
    ...payload,
    ddocId: order.ddocId,
    subname: order.sessionSubname,
    node: namehash(normalize(order.sessionSubname)) as `0x${string}`,
    depositAddress: order.depositAddress,
    parentDdocId: order.parentDdocId ?? null,
    originalAmount: order.originalAmount,
    remainingAmount: order.remainingAmount,
    filledAmount: order.filledAmount,
    submittedAt: order.submittedAt,
    ttlSeconds: order.ttlSeconds,
  };
}

export async function fetchLiveOrders(): Promise<DecryptedOrder[]> {
  const liveOrders: DecryptedOrder[] = [];
  let skip = 0;

  while (true) {
    const { ddocs, hasNext } = await listDocs(PAGE_LIMIT, skip);

    for (const doc of ddocs) {
      if (!doc.ddocId || !doc.content) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(doc.content);
      } catch {
        continue;
      }

      const stored = parseStoredOrder(doc.ddocId, parsed);
      if (!stored) continue;

      if (
        stored.status === 'IN_SETTLEMENT' ||
        stored.status === 'PARTIALLY_FILLED_IN_SETTLEMENT'
      ) {
        console.warn(`[Recovery] Order ${stored.ddocId} mid-settlement — skip`);
        continue;
      }

      if (stored.status !== 'LIVE') continue;

      const expiresAt = stored.submittedAt + stored.ttlSeconds * 1000;
      if (Date.now() > expiresAt) {
        await updateDoc(
          stored.ddocId,
          JSON.stringify({ ...stored, status: 'EXPIRED' })
        );
        continue;
      }

      try {
        liveOrders.push(toDecryptedOrder(stored));
      } catch (err) {
        console.warn(`[Matcher] Failed to decrypt order ${stored.ddocId}; skipping`, err);
      }
    }

    if (!hasNext) break;
    skip += PAGE_LIMIT;
  }

  return liveOrders;
}

export function findMatch(orders: DecryptedOrder[]): MatchResult | null {
  for (let i = 0; i < orders.length; i += 1) {
    for (let j = i + 1; j < orders.length; j += 1) {
      const a = orders[i];
      const b = orders[j];

      const inversePair = a.tokenIn === b.tokenOut && a.tokenOut === b.tokenIn;
      if (!inversePair) continue;

      const priceA = Number.parseFloat(a.limitPrice);
      const priceB = Number.parseFloat(b.limitPrice);
      const priceOverlap = a.type === 'SELL' ? priceA <= priceB : priceB <= priceA;
      if (!priceOverlap) continue;

      const now = Date.now();
      const aLive = a.submittedAt + a.ttlSeconds * 1000 > now;
      const bLive = b.submittedAt + b.ttlSeconds * 1000 > now;
      if (!aLive || !bLive) continue;

      const aRemaining = BigInt(a.remainingAmount);
      const bRemaining = BigInt(b.remainingAmount);
      const fillAmount = aRemaining < bRemaining ? aRemaining : bRemaining;

      return {
        orderA: a,
        orderB: b,
        fillAmount,
        matchedPrice: (priceA + priceB) / 2,
        aFullyFilled: fillAmount === aRemaining,
        bFullyFilled: fillAmount === bRemaining,
      };
    }
  }

  return null;
}

export async function applyPartialFill(match: MatchResult): Promise<void> {
  const entries: Array<[DecryptedOrder, boolean]> = [
    [match.orderA, match.aFullyFilled],
    [match.orderB, match.bFullyFilled],
  ];

  for (const [order, fullyFilled] of entries) {
    const doc = await getDoc(order.ddocId);
    if (!doc.content) continue;
    const payload = JSON.parse(doc.content) as StoredOrder;

    const newFilled = (BigInt(payload.filledAmount) + match.fillAmount).toString();
    const newRemaining = (BigInt(payload.remainingAmount) - match.fillAmount).toString();

    await updateDoc(
      order.ddocId,
      JSON.stringify({
        ...payload,
        filledAmount: newFilled,
        remainingAmount: newRemaining,
        status: fullyFilled ? 'IN_SETTLEMENT' : 'PARTIALLY_FILLED_IN_SETTLEMENT',
        lastFillAt: Date.now(),
      })
    );

    if (!fullyFilled) {
      const residual: StoredOrder = {
        ddocId: '',
        sessionSubname: order.subname,
        status: 'LIVE',
        encryptedOrder: payload.encryptedOrder,
        depositAddress: payload.depositAddress,
        originalAmount: payload.originalAmount,
        remainingAmount: newRemaining,
        filledAmount: newFilled,
        parentDdocId: payload.parentDdocId ?? order.ddocId,
        submittedAt: payload.submittedAt,
        ttlSeconds: payload.ttlSeconds,
      };
      const residualId = await createDoc('order-residual', JSON.stringify(residual));
      await waitForSync(residualId);
    }
  }
}

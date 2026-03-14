import type {
  DecryptedOrder,
  MatchResult,
  StoredOrder,
} from '../types';
import { decryptStoredOrder, parseStoredOrder } from './orderStore.js';
import { decryptOrderPayload } from './crypto.js';
import { refundDeposit } from './settlement.js';
import { createDoc, getDoc, listDocs, updateDoc, waitForSync } from './orders.js';

const PAGE_LIMIT = 50;

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
        let refundTxHash: string | null = stored.refundTxHash ?? null;
        let refundError: string | null = null;
        try {
          const payload = decryptOrderPayload(stored.encryptedOrder);
          const refundAddress = typeof payload.refundAddress === 'string' ? payload.refundAddress : null;
          const refundAmount = stored.remainingAmount || stored.originalAmount || payload.amount;
          if (!refundTxHash && refundAddress && refundAmount) {
            refundTxHash = await refundDeposit(refundAddress, refundAmount, payload.tokenIn);
          } else if (!refundAddress) {
            refundError = 'Missing refund address';
          }
        } catch (err) {
          refundError = String(err);
        }

        await updateDoc(
          stored.ddocId,
          JSON.stringify({
            ...stored,
            status: 'EXPIRED',
            refundTxHash: refundTxHash || undefined,
            refundRequestedAt: Date.now(),
            refundCompletedAt: refundTxHash ? Date.now() : undefined,
            refundError: refundError || undefined,
            refundLastAttemptAt: refundError ? Date.now() : stored.refundLastAttemptAt,
          })
        );
        continue;
      }

      try {
        liveOrders.push(decryptStoredOrder(stored));
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

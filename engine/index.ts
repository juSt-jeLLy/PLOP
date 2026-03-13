import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import type { DecryptedOrder, MatchResult } from '../types';
import { applyPartialFill, fetchLiveOrders, findMatch } from './matcher.js';
import { writeReceipt } from './receipts.js';
import { createDepositAddress, isEthOnlyPair, settleEthOnly } from './settlement.js';
import {
  generateSubname,
  resolveSessionAddress,
  rotateSessionAddress,
  setSessionMetadata,
  setTextRecord,
} from './session.js';
import { createBitgoWebhookHandler } from './webhooks.js';
import { getDoc, updateDoc } from './orders.js';

const PORT = Number(process.env.ENGINE_PORT || 3001);
const POLL_INTERVAL_MS = Number(process.env.ENGINE_POLL_INTERVAL_MS || 15000);

const app = express();

app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  })
);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/webhooks/bitgo', createBitgoWebhookHandler());

app.post('/session', async (req, res) => {
  try {
    const walletAddress = req.body?.walletAddress;
    const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];

    if (typeof walletAddress !== 'string') {
      res.status(400).json({ error: 'walletAddress is required' });
      return;
    }

    const subname = generateSubname(walletAddress as `0x${string}`);
    const depositAddress = await createDepositAddress(`session-${subname}`);

    await setSessionMetadata(subname, {
      'plop.active': 'true',
      'plop.deposit': depositAddress,
      'plop.pairs': pairs.join(','),
      'plop.receipts': '',
    });

    res.status(200).json({ subname, depositAddress });
  } catch (err) {
    console.error('[Engine] /session failed', err);
    res.status(500).json({ error: String(err) });
  }
});

async function rotateIfFullyFilled(order: DecryptedOrder, fullyFilled: boolean): Promise<void> {
  if (!fullyFilled) return;
  await rotateSessionAddress(order.subname);
  await setTextRecord(order.subname, 'plop.active', 'false');
}

async function finalizeOrder(
  order: DecryptedOrder,
  fullyFilled: boolean,
  counterpartyEns: string,
  matchedPrice: number,
  txHashes: string[]
): Promise<void> {
  const doc = await getDoc(order.ddocId);
  if (!doc.content) return;
  const payload = JSON.parse(doc.content);
  await updateDoc(
    order.ddocId,
    JSON.stringify({
      ...payload,
      status: fullyFilled ? 'MATCHED' : 'PARTIALLY_FILLED',
      settledAt: Date.now(),
      settlementTxHash: txHashes.join(','),
      matchedPrice,
      counterpartyEns,
    })
  );
}

async function markSettlementFailed(match: MatchResult, error: unknown): Promise<void> {
  const entries: Array<DecryptedOrder> = [match.orderA, match.orderB];
  for (const order of entries) {
    const doc = await getDoc(order.ddocId);
    if (!doc.content) continue;
    const payload = JSON.parse(doc.content);
    await updateDoc(
      order.ddocId,
      JSON.stringify({
        ...payload,
        status: 'SETTLEMENT_FAILED',
        settlementError: String(error),
      })
    );
  }
}

let matchingInFlight = false;

async function matchingCycle(): Promise<void> {
  if (matchingInFlight) return;
  matchingInFlight = true;

  let match: MatchResult | null = null;
  try {
    const orders = await fetchLiveOrders();
    match = findMatch(orders);
    if (!match) return;

    await applyPartialFill(match);

    const [addressA, addressB] = await Promise.all([
      resolveSessionAddress(match.orderA.subname),
      resolveSessionAddress(match.orderB.subname),
    ]);

    if (!addressA || !addressB) {
      throw new Error('[ENS] Failed to resolve session addresses');
    }

    if (!isEthOnlyPair(match.orderA.tokenIn, match.orderA.tokenOut)) {
      throw new Error('[Settlement] Non-ETH pair not supported in demo engine');
    }

    const testRecipient = process.env.ENGINE_TEST_RECIPIENT;
    const settlementAddressA = testRecipient || addressA;
    const settlementAddressB = testRecipient || addressB;

    if (testRecipient) {
      console.log('[Engine] ENGINE_TEST_RECIPIENT override in use:', testRecipient);
    }

    const { txHashes } = await settleEthOnly(
      settlementAddressA,
      settlementAddressB,
      match.fillAmount.toString()
    );

    await rotateIfFullyFilled(match.orderA, match.aFullyFilled);
    await rotateIfFullyFilled(match.orderB, match.bFullyFilled);

    await finalizeOrder(
      match.orderA,
      match.aFullyFilled,
      match.orderB.subname,
      match.matchedPrice,
      txHashes
    );
    await finalizeOrder(
      match.orderB,
      match.bFullyFilled,
      match.orderA.subname,
      match.matchedPrice,
      txHashes
    );

    await writeReceipt(
      match.orderA,
      match.orderB,
      match.fillAmount,
      txHashes,
      match.matchedPrice
    );
    await writeReceipt(
      match.orderB,
      match.orderA,
      match.fillAmount,
      txHashes,
      match.matchedPrice
    );
  } catch (err) {
    if (match) {
      await markSettlementFailed(match, err);
    }
    console.error('[Engine] Matching cycle error:', err);
  } finally {
    matchingInFlight = false;
  }
}

app.listen(PORT, () => {
  console.log(`[Engine] listening on ${PORT}`);
  setInterval(() => {
    matchingCycle().catch((err) => {
      console.error('[Engine] Matching cycle failed:', err);
    });
  }, POLL_INTERVAL_MS);
});

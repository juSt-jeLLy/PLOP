import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import type { DecryptedOrder, MatchResult } from '../types';
import { applyPartialFill, fetchLiveOrders, findMatch } from './matcher.js';
import { writeReceipt } from './receipts.js';
import {
  PartialSettlementError,
  createDepositAddress,
  isEthOnlyPair,
  settleEthOnly,
  settleTokenPair,
} from './settlement.js';
import {
  generateSubname,
  resolveSessionAddress,
  setSessionMetadata,
} from './session.js';
import { startHoodiDepositWatcher } from './hoodi.js';
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

async function markPartialSettlement(
  match: MatchResult,
  error: PartialSettlementError
): Promise<void> {
  const entries: Array<DecryptedOrder> = [match.orderA, match.orderB];
  for (const order of entries) {
    const doc = await getDoc(order.ddocId);
    if (!doc.content) continue;
    const payload = JSON.parse(doc.content);
    await updateDoc(
      order.ddocId,
      JSON.stringify({
        ...payload,
        status: 'PARTIAL_SETTLEMENT',
        settlementTxHash: error.txHash,
        settlementError: error.message,
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

    const testRecipient = process.env.ENGINE_TEST_RECIPIENT;
    const settlementAddressA = testRecipient || addressA;
    const settlementAddressB = testRecipient || addressB;

    if (testRecipient) {
      console.log('[Engine] ENGINE_TEST_RECIPIENT override in use:', testRecipient);
    }

    const amountWei = match.fillAmount.toString();
    const { txHashes } = isEthOnlyPair(match.orderA.tokenIn, match.orderA.tokenOut)
      ? await settleEthOnly(settlementAddressA, settlementAddressB, amountWei)
      : await settleTokenPair(
          match.orderA.tokenIn,
          match.orderA.tokenOut,
          settlementAddressA,
          settlementAddressB,
          amountWei
        );

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
      if (err instanceof PartialSettlementError) {
        await markPartialSettlement(match, err);
      } else {
        await markSettlementFailed(match, err);
      }
    }
    console.error('[Engine] Matching cycle error:', err);
  } finally {
    matchingInFlight = false;
  }
}

app.listen(PORT, () => {
  console.log(`[Engine] listening on ${PORT}`);
  startHoodiDepositWatcher();
  setInterval(() => {
    matchingCycle().catch((err) => {
      console.error('[Engine] Matching cycle failed:', err);
    });
  }, POLL_INTERVAL_MS);
});

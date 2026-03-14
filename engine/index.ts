import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import type { DecryptedOrder, MatchResult, StoredOrder } from '../types';
import { applyPartialFill, fetchLiveOrders, findMatch } from './matcher.js';
import { writeReceipt } from './receipts.js';
import {
  PartialSettlementError,
  createDepositAddress,
  isEthOnlyPair,
  refundDeposit,
  settleEthOnly,
  settleTokenPair,
} from './settlement.js';
import {
  generateSubname,
  getSettlementInstruction,
  getTextRecord,
  resolveSessionAddress,
  setSessionMetadata,
} from './session.js';
import {
  createSettlementInstruction,
  encodeSettlementInstruction,
} from './settlementInstructions.js';
import { recordSettlementInstruction } from './settlementController.js';
import { startHoodiDepositWatcher } from './hoodi.js';
import { createBitgoWebhookHandler } from './webhooks.js';
import { createDoc, getDoc, listDocs, updateDoc, waitForSync } from './orders.js';
import { decryptOrderPayload } from './crypto.js';
import { decryptStoredOrder, parseStoredOrder } from './orderStore.js';

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

app.get('/config', (_req, res) => {
  res.status(200).json({
    enginePublicKey: process.env.ENGINE_PUBLIC_KEY ?? null,
    settlementController: process.env.SETTLEMENT_CONTROLLER_ADDRESS ?? null,
    hoodiChainId: Number(
      process.env.HOODI_CHAIN_ID ?? process.env.ETH_HOODI_CHAIN_ID ?? 560048
    ),
  });
});

app.post('/webhooks/bitgo', createBitgoWebhookHandler());

app.post('/session', async (req, res) => {
  try {
    const walletAddress = req.body?.walletAddress;
    const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
    const settlement =
      req.body?.settlement && typeof req.body.settlement === 'object' ? req.body.settlement : {};

    if (typeof walletAddress !== 'string') {
      res.status(400).json({ error: 'walletAddress is required' });
      return;
    }

    const subname = generateSubname(walletAddress as `0x${string}`);
    const depositAddress = await createDepositAddress(`session-${subname}`);
    const chainId = Number(
      settlement?.chainId ?? process.env.HOODI_CHAIN_ID ?? process.env.ETH_HOODI_CHAIN_ID ?? 560048
    );
    const recipient = (settlement?.recipient as string | undefined) ?? walletAddress;
    const controllerAddress = process.env.SETTLEMENT_CONTROLLER_ADDRESS;
    const hasController = typeof controllerAddress === 'string' && controllerAddress.length > 0;

    const settlementPayload = typeof settlement?.payload === 'string' ? settlement.payload : undefined;
    const settlementSignature = typeof settlement?.signature === 'string' ? settlement.signature : undefined;
    const settlementNonce = typeof settlement?.nonce === 'string' ? settlement.nonce : undefined;
    const settlementExpiry = typeof settlement?.expiry === 'number' ? settlement.expiry : undefined;

    let settlementBlob: string | null = null;
    if (!hasController) {
      const settlementInstruction = createSettlementInstruction({
        recipient: recipient as `0x${string}`,
        chainId,
        tokenOut: typeof settlement?.tokenOut === 'string' ? settlement.tokenOut : undefined,
        minAmount: typeof settlement?.minAmount === 'string' ? settlement.minAmount : undefined,
        expiry: typeof settlement?.expiry === 'number' ? settlement.expiry : undefined,
        nonce: typeof settlement?.nonce === 'string' ? settlement.nonce : undefined,
        sessionId: typeof settlement?.sessionId === 'string' ? settlement.sessionId : undefined,
        orderId: typeof settlement?.orderId === 'string' ? settlement.orderId : undefined,
      });
      settlementBlob = encodeSettlementInstruction(settlementInstruction);
    } else if (
      settlementPayload &&
      settlementSignature &&
      settlementNonce &&
      typeof settlementExpiry === 'number'
    ) {
      await recordSettlementInstruction({
        ensSubname: subname,
        payload: settlementPayload,
        signature: settlementSignature,
        nonce: settlementNonce,
        expiry: settlementExpiry,
      });
    }

    await setSessionMetadata(subname, {
      'plop.active': 'true',
      'plop.deposit': depositAddress,
      'plop.pairs': pairs.join(','),
      'plop.receipts': '',
      ...(settlementBlob ? { 'plop.settlement': settlementBlob } : {}),
    });

    res.status(200).json({ subname, depositAddress });
  } catch (err) {
    console.error('[Engine] /session failed', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/session/settlement', async (req, res) => {
  try {
    const ensSubname = req.body?.ensSubname;
    const controllerAddress = process.env.SETTLEMENT_CONTROLLER_ADDRESS;
    const hasController = typeof controllerAddress === 'string' && controllerAddress.length > 0;

    if (typeof ensSubname !== 'string') {
      res.status(400).json({ error: 'ensSubname is required' });
      return;
    }

    if (hasController) {
      const payload = req.body?.payload;
      const signature = req.body?.signature;
      const expiry = req.body?.expiry;
      const nonce = req.body?.nonce;
      if (
        typeof payload !== 'string' ||
        typeof signature !== 'string' ||
        typeof expiry !== 'number' ||
        typeof nonce !== 'string'
      ) {
        res.status(400).json({ error: 'payload, signature, expiry, nonce are required' });
        return;
      }

      await recordSettlementInstruction({
        ensSubname,
        payload,
        signature,
        expiry,
        nonce,
      });

      res.status(200).json({ ok: true });
      return;
    }

    const recipient = req.body?.recipient;
    const settlement =
      req.body?.settlement && typeof req.body.settlement === 'object' ? req.body.settlement : {};

    if (typeof recipient !== 'string') {
      res.status(400).json({ error: 'recipient is required' });
      return;
    }

    const chainId = Number(
      settlement?.chainId ?? process.env.HOODI_CHAIN_ID ?? process.env.ETH_HOODI_CHAIN_ID ?? 560048
    );
    const instruction = createSettlementInstruction({
      recipient: recipient as `0x${string}`,
      chainId,
      tokenOut: typeof settlement?.tokenOut === 'string' ? settlement.tokenOut : undefined,
      minAmount: typeof settlement?.minAmount === 'string' ? settlement.minAmount : undefined,
      expiry: typeof settlement?.expiry === 'number' ? settlement.expiry : undefined,
      nonce: typeof settlement?.nonce === 'string' ? settlement.nonce : undefined,
      sessionId: typeof settlement?.sessionId === 'string' ? settlement.sessionId : undefined,
      orderId: typeof settlement?.orderId === 'string' ? settlement.orderId : undefined,
    });

    await setSessionMetadata(ensSubname, {
      'plop.settlement': encodeSettlementInstruction(instruction),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Engine] /session/settlement failed', err);
    res.status(500).json({ error: String(err) });
  }
});

const ORDER_PAGE_LIMIT = 50;

async function listOrdersForSession(
  sessionSubname: string,
  statusFilter?: string[]
): Promise<Array<Record<string, unknown>>> {
  const orders: Array<Record<string, unknown>> = [];
  let skip = 0;

  while (true) {
    const { ddocs, hasNext } = await listDocs(ORDER_PAGE_LIMIT, skip);
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
      if (stored.sessionSubname !== sessionSubname) continue;
      if (statusFilter && statusFilter.length && !statusFilter.includes(stored.status)) continue;

      try {
        const decrypted = decryptStoredOrder(stored);
        orders.push({
          ddocId: stored.ddocId,
          sessionSubname: stored.sessionSubname,
          status: stored.status,
          tokenIn: decrypted.tokenIn,
          tokenOut: decrypted.tokenOut,
          type: decrypted.type,
          amount: stored.originalAmount,
          remainingAmount: stored.remainingAmount,
          filledAmount: stored.filledAmount,
          limitPrice: decrypted.limitPrice,
          ttlSeconds: stored.ttlSeconds,
          submittedAt: stored.submittedAt,
          settlementTxHash: stored.settlementTxHash,
          matchedPrice: stored.matchedPrice,
          counterpartyEns: stored.counterpartyEns,
          settledAt: stored.settledAt,
          parentDdocId: stored.parentDdocId,
          refundTxHash: stored.refundTxHash,
          refundError: stored.refundError,
          refundRequestedAt: stored.refundRequestedAt,
          refundCompletedAt: stored.refundCompletedAt,
          refundLastAttemptAt: stored.refundLastAttemptAt,
        });
      } catch (err) {
        console.warn(`[Engine] Failed to decrypt order ${stored.ddocId}; skipping`, err);
      }
    }
    if (!hasNext) break;
    skip += ORDER_PAGE_LIMIT;
  }

  return orders;
}

async function listAllOrders(statusFilter?: string[]): Promise<Array<Record<string, unknown>>> {
  const orders: Array<Record<string, unknown>> = [];
  let skip = 0;

  while (true) {
    const { ddocs, hasNext } = await listDocs(ORDER_PAGE_LIMIT, skip);
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
      if (statusFilter && statusFilter.length && !statusFilter.includes(stored.status)) continue;

      try {
        const decrypted = decryptStoredOrder(stored);
        orders.push({
          ddocId: stored.ddocId,
          sessionSubname: stored.sessionSubname,
          status: stored.status,
          tokenIn: decrypted.tokenIn,
          tokenOut: decrypted.tokenOut,
          type: decrypted.type,
          amount: stored.originalAmount,
          remainingAmount: stored.remainingAmount,
          filledAmount: stored.filledAmount,
          limitPrice: decrypted.limitPrice,
          ttlSeconds: stored.ttlSeconds,
          submittedAt: stored.submittedAt,
          settlementTxHash: stored.settlementTxHash,
          matchedPrice: stored.matchedPrice,
          counterpartyEns: stored.counterpartyEns,
          settledAt: stored.settledAt,
          parentDdocId: stored.parentDdocId,
          refundTxHash: stored.refundTxHash,
          refundError: stored.refundError,
          refundRequestedAt: stored.refundRequestedAt,
          refundCompletedAt: stored.refundCompletedAt,
          refundLastAttemptAt: stored.refundLastAttemptAt,
        });
      } catch (err) {
        console.warn(`[Engine] Failed to decrypt order ${stored.ddocId}; skipping`, err);
      }
    }
    if (!hasNext) break;
    skip += ORDER_PAGE_LIMIT;
  }

  return orders;
}

app.get('/orders', async (req, res) => {
  try {
    const sessionSubname = req.query?.sessionSubname;
    if (typeof sessionSubname !== 'string') {
      res.status(400).json({ error: 'sessionSubname is required' });
      return;
    }
    const statusRaw = typeof req.query?.status === 'string' ? req.query.status : undefined;
    const statusFilter = statusRaw ? statusRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const orders = await listOrdersForSession(sessionSubname, statusFilter);
    res.status(200).json({ orders });
  } catch (err) {
    console.error('[Engine] /orders failed', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/orders/all', async (req, res) => {
  try {
    const statusRaw = typeof req.query?.status === 'string' ? req.query.status : undefined;
    const statusFilter = statusRaw ? statusRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const orders = await listAllOrders(statusFilter);
    res.status(200).json({ orders });
  } catch (err) {
    console.error('[Engine] /orders/all failed', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/orders', async (req, res) => {
  try {
    const sessionSubname = req.body?.sessionSubname;
    const encryptedOrder = req.body?.encryptedOrder;
    const depositOverride = req.body?.depositAddress;

    if (typeof sessionSubname !== 'string') {
      res.status(400).json({ error: 'sessionSubname is required' });
      return;
    }
    if (
      !encryptedOrder
      || typeof encryptedOrder.encryptedB64 !== 'string'
      || typeof encryptedOrder.nonceB64 !== 'string'
      || typeof encryptedOrder.ephemeralPublicKeyB64 !== 'string'
    ) {
      res.status(400).json({ error: 'encryptedOrder is required' });
      return;
    }

    const payload = decryptOrderPayload(encryptedOrder);
    if (
      typeof payload.amount !== 'string'
      || typeof payload.limitPrice !== 'string'
      || typeof payload.ttlSeconds !== 'number'
      || typeof payload.type !== 'string'
      || typeof payload.tokenIn !== 'string'
      || typeof payload.tokenOut !== 'string'
    ) {
      res.status(400).json({ error: 'invalid order payload' });
      return;
    }

    const depositAddress =
      typeof depositOverride === 'string'
        ? depositOverride
        : (await getTextRecord(sessionSubname, 'plop.deposit')) ?? undefined;

    if (!depositAddress) {
      res.status(400).json({ error: 'deposit address not found for session' });
      return;
    }

    const stored: StoredOrder = {
      ddocId: '',
      sessionSubname,
      status: 'PENDING_DEPOSIT',
      encryptedOrder,
      depositAddress,
      originalAmount: payload.amount,
      remainingAmount: payload.amount,
      filledAmount: '0',
      parentDdocId: null,
      submittedAt: Date.now(),
      ttlSeconds: payload.ttlSeconds,
    };

    const ddocId = await createDoc('order', JSON.stringify(stored));
    await waitForSync(ddocId);

    res.status(200).json({
      ddocId,
      status: stored.status,
      depositAddress,
      submittedAt: stored.submittedAt,
    });
  } catch (err) {
    console.error('[Engine] /orders create failed', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/orders/:id/cancel', async (req, res) => {
  try {
    const ddocId = req.params?.id;
    if (!ddocId) {
      res.status(400).json({ error: 'order id required' });
      return;
    }
    const doc = await getDoc(ddocId);
    if (!doc.content) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    const parsed = JSON.parse(doc.content);
    const stored = parseStoredOrder(ddocId, parsed);
    if (!stored) {
      res.status(400).json({ error: 'invalid order document' });
      return;
    }

    let refundTxHash: string | null = null;
    let refundError: string | null = null;
    try {
      const payload = decryptOrderPayload(stored.encryptedOrder);
      const refundAddress = typeof payload.refundAddress === 'string' ? payload.refundAddress : null;
      const tokenIn = payload.tokenIn;
      const refundAmount = stored.remainingAmount || stored.originalAmount || payload.amount;

      if (refundAddress && tokenIn && refundAmount) {
        if (stored.status === 'LIVE') {
          try {
            refundTxHash = await refundDeposit(refundAddress, refundAmount, tokenIn);
          } catch (err) {
            refundError = String(err);
          }
        }
      } else {
        refundError = 'Missing refund address or tokenIn';
      }
    } catch (err) {
      refundError = String(err);
    }

    await updateDoc(
      ddocId,
      JSON.stringify({
        ...stored,
        status: 'CANCELLED',
        refundTxHash: refundTxHash || undefined,
        refundRequestedAt: Date.now(),
        refundError: refundError || undefined,
        refundCompletedAt: refundTxHash ? Date.now() : undefined,
      })
    );
    res.status(200).json({ ok: true, refundTxHash, refundError });
  } catch (err) {
    console.error('[Engine] /orders cancel failed', err);
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

    const [instructionA, instructionB] = await Promise.all([
      getSettlementInstruction(match.orderA.subname),
      getSettlementInstruction(match.orderB.subname),
    ]);

    const [addressA, addressB] = await Promise.all([
      instructionA?.recipient ?? resolveSessionAddress(match.orderA.subname),
      instructionB?.recipient ?? resolveSessionAddress(match.orderB.subname),
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

import type { DecryptedOrder, ReceiptPayload } from '../types';
import { encryptForRecipient } from './crypto.js';
import { createDoc, waitForSync } from './orders.js';
import { getTextRecord, setTextRecord } from './session.js';

function buildReceipt(
  order: DecryptedOrder,
  counterpartyEns: string,
  fillAmount: bigint,
  txHashes: string[],
  matchedPrice: number
): ReceiptPayload {
  return {
    orderDdocId: order.ddocId,
    counterpartyEns,
    fillAmount: fillAmount.toString(),
    matchedPrice,
    txHashes,
    timestamp: Date.now(),
    originalAmount: order.originalAmount,
    filledAmount: order.filledAmount,
    remainingAmount: order.remainingAmount,
    parentDdocId: order.parentDdocId,
  };
}

async function appendReceiptRecord(ensSubname: string, ddocId: string): Promise<void> {
  const existing = await getTextRecord(ensSubname, 'plop.receipts');
  const entries = existing
    ? existing.split(',').map(item => item.trim()).filter(Boolean)
    : [];

  if (!entries.includes(ddocId)) entries.push(ddocId);
  await setTextRecord(ensSubname, 'plop.receipts', entries.join(','));
}

export async function writeReceipt(
  order: DecryptedOrder,
  counterparty: DecryptedOrder,
  fillAmount: bigint,
  txHashes: string[],
  matchedPrice: number
): Promise<string> {
  const receipt = buildReceipt(order, counterparty.subname, fillAmount, txHashes, matchedPrice);
  const encryptedReceipt = encryptForRecipient(
    JSON.stringify(receipt),
    order.traderPublicKey
  );

  const ddocId = await createDoc(
    'receipt',
    JSON.stringify({
      sessionSubname: order.subname,
      encryptedReceipt,
      createdAt: Date.now(),
    })
  );
  await waitForSync(ddocId);
  await appendReceiptRecord(order.subname, ddocId);
  return ddocId;
}

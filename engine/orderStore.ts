import { namehash, normalize } from 'viem/ens';

import type { DecryptedOrder, StoredOrder } from '../types';
import { decryptOrderPayload } from './crypto.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseStoredOrder(ddocId: string, raw: unknown): StoredOrder | null {
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

  const status = raw.status as StoredOrder['status'] | undefined;
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
    settlementError: typeof raw.settlementError === 'string' ? raw.settlementError : undefined,
    refundTxHash: typeof raw.refundTxHash === 'string' ? raw.refundTxHash : undefined,
    refundError: typeof raw.refundError === 'string' ? raw.refundError : undefined,
    refundRequestedAt: typeof raw.refundRequestedAt === 'number' ? raw.refundRequestedAt : undefined,
    refundCompletedAt: typeof raw.refundCompletedAt === 'number' ? raw.refundCompletedAt : undefined,
    refundLastAttemptAt: typeof raw.refundLastAttemptAt === 'number' ? raw.refundLastAttemptAt : undefined,
  };
}

export function decryptStoredOrder(order: StoredOrder): DecryptedOrder {
  const payload = decryptOrderPayload(order.encryptedOrder);
  return {
    ...payload,
    ddocId: order.ddocId,
    subname: order.sessionSubname,
    node: namehash(normalize(order.sessionSubname)) as `0x${string}`,
    depositAddress: order.depositAddress ?? (typeof payload.depositAddress === 'string' ? payload.depositAddress : undefined),
    parentDdocId: order.parentDdocId ?? null,
    originalAmount: order.originalAmount,
    remainingAmount: order.remainingAmount,
    filledAmount: order.filledAmount,
    submittedAt: order.submittedAt,
    ttlSeconds: order.ttlSeconds,
  };
}

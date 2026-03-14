import 'dotenv/config';

import { BitGoAPI } from '@bitgo/sdk-api';
import { Hteth, Teth } from '@bitgo/sdk-coin-eth';

import type { StoredOrder, OrderStatus } from '../types';
import { getDoc } from './orders.js';
import { getSettlementInstruction } from './session.js';
import { decryptOrderPayload } from './crypto.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

type SequenceMatch =
  | { kind: 'match'; orderA: string; orderB: string; leg?: 'A' | 'B' }
  | { kind: 'refund'; orderId: string };

function parseSequenceId(value: string | undefined | null): SequenceMatch | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('plop:')) return null;
  const parts = trimmed.split(':');
  if (parts.length < 3) return null;
  if (parts[1] === 'match' && parts.length >= 4) {
    const orderA = parts[2];
    const orderB = parts[3];
    const leg = parts[4] === 'A' || parts[4] === 'B' ? parts[4] : undefined;
    if (!orderA || !orderB) return null;
    return { kind: 'match', orderA, orderB, leg };
  }
  if (parts[1] === 'refund' && parts[2]) {
    return { kind: 'refund', orderId: parts[2] };
  }
  return null;
}

type Recipient = { address: string; amount: string };

function extractRecipients(info: Record<string, any>): Recipient[] {
  const request = info?.transactionRequest || info?.request || {};
  const directRecipients = request.recipients || request.buildParams?.recipients;
  if (Array.isArray(directRecipients)) {
    return directRecipients
      .map((entry) => {
        const address = String(entry.address || entry.addresses || '').trim();
        const amount = entry.amount ?? entry.value ?? entry.valueString ?? '';
        return address ? { address, amount: String(amount) } : null;
      })
      .filter((entry): entry is Recipient => Boolean(entry));
  }
  if (directRecipients && typeof directRecipients === 'object') {
    return Object.entries(directRecipients).map(([address, amount]) => ({
      address,
      amount: String(amount),
    }));
  }
  if (request.destinationAddress && request.destinationValue !== undefined) {
    return [{ address: String(request.destinationAddress), amount: String(request.destinationValue) }];
  }
  return [];
}

function extractSequence(info: Record<string, any>): string | null {
  const request = info?.transactionRequest || info?.request || {};
  return (
    request.sequenceId
    || request.buildParams?.sequenceId
    || request.comment
    || request.buildParams?.comment
    || null
  );
}

function isSettlementStatus(status: OrderStatus | undefined): boolean {
  return status === 'IN_SETTLEMENT' || status === 'PARTIALLY_FILLED_IN_SETTLEMENT';
}

function parseAmount(value: string): bigint | null {
  try {
    if (!value) return null;
    if (value.includes('.')) {
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return BigInt(Math.floor(num));
    }
    return BigInt(value);
  } catch {
    return null;
  }
}

function amountsEqual(a: string, b: string): boolean {
  const aa = parseAmount(a);
  const bb = parseAmount(b);
  return aa !== null && bb !== null && aa === bb;
}

async function fetchOrder(orderId: string): Promise<StoredOrder | null> {
  const doc = await getDoc(orderId);
  if (!doc.content) return null;
  try {
    return JSON.parse(doc.content) as StoredOrder;
  } catch {
    return null;
  }
}

async function expectedRecipientForOrder(order: StoredOrder): Promise<string | null> {
  const instruction = await getSettlementInstruction(order.sessionSubname);
  return instruction?.recipient ?? null;
}

async function verifyMatchApproval(match: SequenceMatch & { kind: 'match' }, recipients: Recipient[]): Promise<boolean> {
  const orderA = await fetchOrder(match.orderA);
  const orderB = await fetchOrder(match.orderB);
  if (!orderA || !orderB) return false;
  if (!isSettlementStatus(orderA.status) || !isSettlementStatus(orderB.status)) return false;

  const [recipientA, recipientB] = await Promise.all([
    expectedRecipientForOrder(orderA),
    expectedRecipientForOrder(orderB),
  ]);
  if (!recipientA || !recipientB) return false;

  const expectedA = orderA.lastFillAmount || '';
  const expectedB = orderB.lastFillAmount || '';
  if (!expectedA || !expectedB) return false;

  const normalized = recipients.map((r) => ({
    address: normalizeAddress(r.address),
    amount: String(r.amount),
  }));

  if (match.leg === 'A' || match.leg === 'B') {
    if (normalized.length !== 1) return false;
    const expectedRecipient = match.leg === 'A' ? recipientA : recipientB;
    const expectedAmount = match.leg === 'A' ? expectedA : expectedB;
    return (
      normalizeAddress(expectedRecipient) === normalized[0].address
      && amountsEqual(expectedAmount, normalized[0].amount)
    );
  }

  if (normalized.length !== 2) return false;
  const want = new Map([
    [normalizeAddress(recipientA), expectedA],
    [normalizeAddress(recipientB), expectedB],
  ]);
  for (const entry of normalized) {
    const expected = want.get(entry.address);
    if (!expected || !amountsEqual(expected, entry.amount)) return false;
  }
  return true;
}

async function verifyRefundApproval(match: SequenceMatch & { kind: 'refund' }, recipients: Recipient[]): Promise<boolean> {
  const order = await fetchOrder(match.orderId);
  if (!order) return false;

  const payload = decryptOrderPayload(order.encryptedOrder);
  const refundAddress = typeof payload.refundAddress === 'string' ? payload.refundAddress : null;
  if (!refundAddress) return false;

  const expectedAmount = order.remainingAmount || order.originalAmount || payload.amount;
  if (!expectedAmount) return false;
  if (recipients.length !== 1) return false;

  const entry = recipients[0];
  return (
    normalizeAddress(refundAddress) === normalizeAddress(entry.address)
    && amountsEqual(expectedAmount, entry.amount)
  );
}

async function processApproval(pending: any, walletPassphrase: string, rejectOnFail: boolean): Promise<void> {
  const info = pending.info();
  if (pending.state() !== 'pending') return;
  if (pending.type() !== 'transactionRequest') return;

  const recipients = extractRecipients(info);
  if (recipients.length === 0) return;

  const sequenceId = extractSequence(info);
  const parsed = parseSequenceId(sequenceId);
  if (!parsed) return;

  let ok = false;
  if (parsed.kind === 'match') {
    ok = await verifyMatchApproval(parsed, recipients);
  } else if (parsed.kind === 'refund') {
    ok = await verifyRefundApproval(parsed, recipients);
  }

  if (!ok) {
    if (rejectOnFail) {
      console.warn('[Approver] Rejecting pending approval', pending.id());
      await pending.reject();
    } else {
      console.warn('[Approver] Skipping pending approval', pending.id());
    }
    return;
  }

  console.log('[Approver] Approving pending approval', pending.id());
  await pending.approve({ walletPassphrase });
}

async function main(): Promise<void> {
  const accessToken = process.env.APPROVER_BITGO_ACCESS_TOKEN || requireEnv('BITGO_ACCESS_TOKEN');
  const walletId = requireEnv('BITGO_WALLET_ID');
  const enterpriseId = process.env.BITGO_ENTERPRISE_ID;
  const walletPassphrase = process.env.APPROVER_WALLET_PASSPHRASE || requireEnv('BITGO_WALLET_PASSPHRASE');
  const pollInterval = Number(process.env.APPROVER_POLL_INTERVAL_MS || 15000);
  const rejectOnFail = process.env.APPROVER_REJECT_ON_FAIL !== '0';

  const bitgo = new BitGoAPI({ env: 'test' });
  bitgo.register('teth', Teth.createInstance);
  bitgo.register('hteth', Hteth.createInstance);
  await bitgo.authenticateWithAccessToken({ accessToken });

  console.log('[Approver] running...');

  const runOnce = async () => {
    try {
      let pendingApprovals: any[] = [];
      try {
        const response = await bitgo.pendingApprovals().list({ walletId });
        pendingApprovals = response.pendingApprovals || [];
      } catch (err: any) {
        const message = String(err?.result?.error || err?.message || err);
        if (enterpriseId && message.includes('invalid wallet id')) {
          console.warn('[Approver] walletId rejected; falling back to enterprise pending approvals');
          const response = await bitgo.pendingApprovals().list({ enterpriseId });
          pendingApprovals = (response.pendingApprovals || []).filter((pending: any) => {
            try {
              return pending.walletId?.() === walletId;
            } catch {
              return false;
            }
          });
        } else {
          throw err;
        }
      }
      for (const pending of pendingApprovals) {
        try {
          await processApproval(pending, walletPassphrase, rejectOnFail);
        } catch (err) {
          console.warn('[Approver] Failed to process approval', pending.id(), err);
        }
      }
    } catch (err) {
      console.warn('[Approver] Failed to list pending approvals', err);
    }
  };

  await runOnce();
  setInterval(() => {
    void runOnce();
  }, pollInterval);
}

main().catch((err) => {
  console.error('[Approver] fatal error', err);
  process.exit(1);
});

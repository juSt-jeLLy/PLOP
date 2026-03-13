import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

import type { BitgoWebhookPayload, OrderStatus, StoredOrder } from '../types';
import { getTextRecord, rotateSessionAddress, setTextRecord } from './session.js';
import { listDocs, updateDoc } from './orders.js';

type RawBodyRequest = Request & { rawBody?: string };

const PAGE_LIMIT = 50;

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function getSignatureHeader(req: Request): string | null {
  const candidates = ['x-signature-sha256', 'x-signature'];
  for (const header of candidates) {
    const value = req.headers[header];
    if (Array.isArray(value)) return value[0] ?? null;
    if (typeof value === 'string') return value;
  }
  return null;
}

function verifyBitgoSignature(rawBody: string, signature: string, secret: string): boolean {
  const normalized = signature.replace(/^sha256=/, '').trim();
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(normalized, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

function extractTransferAddresses(payload: BitgoWebhookPayload): string[] {
  const entries = payload.transfer?.entries ?? [];
  const addresses: string[] = [];
  for (const entry of entries) {
    if (entry?.address && typeof entry.address === 'string') {
      addresses.push(entry.address);
    }
  }
  return Array.from(new Set(addresses.map(normalizeAddress)));
}

function extractTransferIdentifiers(payload: BitgoWebhookPayload): string[] {
  const transfer = (payload as Record<string, unknown>)?.transfer as Record<string, unknown> | undefined;
  const candidates: Array<unknown> = [
    transfer?.id,
    transfer?.txid,
    transfer?.txHash,
    transfer?.hash,
    (transfer as { txid?: unknown })?.txid,
  ];
  const ids = candidates
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.trim());
  return Array.from(new Set(ids));
}

function isPendingDeposit(status: OrderStatus | undefined): boolean {
  return status === 'PENDING_DEPOSIT';
}

async function markOrdersLiveByDepositAddress(address: string): Promise<void> {
  let skip = 0;
  const target = normalizeAddress(address);

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
      if (!parsed) continue;

      const status = parsed.status as OrderStatus | undefined;
      if (!isPendingDeposit(status)) continue;

      let depositAddress = parsed.depositAddress;
      if (!depositAddress && parsed.sessionSubname) {
        depositAddress = await getTextRecord(parsed.sessionSubname, 'plop.deposit') ?? undefined;
      }
      if (!depositAddress) continue;

      if (normalizeAddress(depositAddress) !== target) continue;

      await updateDoc(
        doc.ddocId,
        JSON.stringify({
          ...parsed,
          status: 'LIVE',
          depositConfirmedAt: Date.now(),
        })
      );
    }

    if (!hasNext) break;
    skip += PAGE_LIMIT;
  }
}

async function handleTransferConfirmed(payload: BitgoWebhookPayload): Promise<void> {
  const addresses = extractTransferAddresses(payload);
  for (const address of addresses) {
    await markOrdersLiveByDepositAddress(address);
  }

  const identifiers = extractTransferIdentifiers(payload);
  if (identifiers.length === 0) return;

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
      if (!parsed) continue;
      if (parsed.status !== 'MATCHED') continue;
      if (!parsed.settlementTxHash || !parsed.sessionSubname) continue;

      const hashes = parsed.settlementTxHash
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const match = hashes.some((hash) => identifiers.includes(hash));
      if (!match) continue;

      const active = await getTextRecord(parsed.sessionSubname, 'plop.active');
      if (active === 'false') continue;

      await rotateSessionAddress(parsed.sessionSubname);
      await setTextRecord(parsed.sessionSubname, 'plop.active', 'false');
    }
    if (!hasNext) break;
    skip += PAGE_LIMIT;
  }
}

export function createBitgoWebhookHandler() {
  return async (req: RawBodyRequest, res: Response) => {
    const secret = process.env.BITGO_WEBHOOK_SECRET;
    const signature = getSignatureHeader(req);
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});

    if (secret && signature) {
      const ok = verifyBitgoSignature(rawBody, signature, secret);
      if (!ok) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else if (!secret) {
      console.warn('[Webhooks] BITGO_WEBHOOK_SECRET not set; skipping signature check');
    }

    const payload = req.body as BitgoWebhookPayload;
    const type = payload?.type;
    const state = payload?.state ?? payload?.transfer?.state;

    if (type === 'transfer' && state === 'confirmed') {
      await handleTransferConfirmed(payload);
    }

    res.status(200).json({ ok: true });
  };
}

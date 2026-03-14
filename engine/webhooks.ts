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

function extractTransferId(payload: BitgoWebhookPayload): string | null {
  const transfer = (payload as Record<string, unknown>)?.transfer;
  if (typeof transfer === 'string') return transfer;
  if (transfer && typeof transfer === 'object') {
    const id = (transfer as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
}

function extractTransferHash(payload: BitgoWebhookPayload): string | null {
  const hash = (payload as { hash?: unknown }).hash;
  if (typeof hash === 'string') return hash;
  const txid = (payload as { txid?: unknown }).txid;
  if (typeof txid === 'string') return txid;
  const transfer = (payload as Record<string, unknown>)?.transfer as Record<string, unknown> | undefined;
  const transferHash = transfer?.hash ?? transfer?.txid ?? transfer?.txHash;
  if (typeof transferHash === 'string') return transferHash;
  return null;
}

async function fetchTransferEntries(transferId: string, walletId: string, coin: string): Promise<string[]> {
  const accessToken = process.env.BITGO_ACCESS_TOKEN;
  if (!accessToken) return [];
  const baseUrl = process.env.BITGO_BASE_URL || 'https://app.bitgo-test.com';
  const url = `${baseUrl}/api/v2/${coin}/wallet/${walletId}/transfer/${transferId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.warn('[Webhooks] BitGo transfer lookup failed', res.status);
    return [];
  }
  const payload = await res.json().catch(() => null);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const addresses = entries
    .map((entry: { address?: unknown }) => (typeof entry.address === 'string' ? entry.address : null))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(addresses.map(normalizeAddress)));
}

async function resolveTransferAddresses(payload: BitgoWebhookPayload): Promise<string[]> {
  const direct = extractTransferAddresses(payload);
  if (direct.length) return direct;

  const transferId = extractTransferId(payload);
  if (!transferId) return [];

  const walletId = process.env.BITGO_WALLET_ID
    || (typeof (payload as { wallet?: unknown }).wallet === 'string'
      ? (payload as { wallet?: string }).wallet
      : '');
  if (!walletId) return [];

  const coin = process.env.BITGO_WALLET_COIN
    || (typeof (payload as { coin?: unknown }).coin === 'string'
      ? String((payload as { coin?: string }).coin)
      : 'hteth');

  return fetchTransferEntries(transferId, walletId, coin);
}

function extractTransferIdentifiers(payload: BitgoWebhookPayload): string[] {
  const transfer = (payload as Record<string, unknown>)?.transfer as Record<string, unknown> | undefined;
  const candidates: Array<unknown> = [
    extractTransferHash(payload),
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

function parseTxHashes(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeConfirmed(existing: string[] | undefined, incoming: string[]): string[] {
  const set = new Set(existing ?? []);
  for (const hash of incoming) set.add(hash);
  return Array.from(set);
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
  const addresses = await resolveTransferAddresses(payload);
  if (addresses.length === 0) {
    const transferId = extractTransferId(payload);
    const transferHash = extractTransferHash(payload);
    console.warn('[Webhooks] No transfer addresses resolved', {
      transferId,
      transferHash,
      type: payload?.type,
      state: payload?.state ?? payload?.transfer?.state,
    });
  }
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
      if (!parsed.settlementTxHash || !parsed.sessionSubname) continue;

      const expected = parseTxHashes(parsed.settlementTxHash);
      if (expected.length === 0) continue;

      const confirmedNow = expected.filter((hash) => identifiers.includes(hash));
      if (confirmedNow.length === 0) continue;

      const mergedConfirmed = mergeConfirmed(
        parsed.settlementConfirmedTxHashes,
        confirmedNow
      );
      const updated = mergedConfirmed.length !== (parsed.settlementConfirmedTxHashes ?? []).length;

      if (updated) {
        await updateDoc(
          doc.ddocId,
          JSON.stringify({
            ...parsed,
            settlementConfirmedTxHashes: mergedConfirmed,
          })
        );
      }

      if (parsed.status !== 'MATCHED') continue;

      const allConfirmed = expected.every((hash) => mergedConfirmed.includes(hash));
      if (!allConfirmed) continue;

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

    if (secret && !signature) {
      console.warn('[Webhooks] Signature header missing; check BitGo webhook config');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    if (secret && signature) {
      const ok = verifyBitgoSignature(rawBody, signature, secret);
      if (!ok) {
        console.warn('[Webhooks] Invalid signature; check BITGO_WEBHOOK_SECRET');
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

import { BitGoAPI } from '@bitgo/sdk-api';
import { Hteth, Teth } from '@bitgo/sdk-coin-eth';

import type { SettlementResult } from '../types';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function resolveTokenName(token: string): string {
  const normalized = normalizeToken(token);
  const overrides = process.env.BITGO_TOKEN_MAP;
  if (overrides) {
    try {
      const parsed = JSON.parse(overrides) as Record<string, string>;
      const mapped = parsed[normalized];
      if (mapped) return mapped;
    } catch {
      // ignore malformed map
    }
  }
  return normalized;
}

type TransferContext = {
  sequenceId?: string;
  comment?: string;
};

function buildMatchSequenceId(orderAId: string, orderBId: string, leg?: 'A' | 'B'): string {
  return `plop:match:${orderAId}:${orderBId}${leg ? `:${leg}` : ''}`;
}

function buildRefundSequenceId(orderId: string): string {
  return `plop:refund:${orderId}`;
}

function buildComment(sequenceId?: string): string | undefined {
  if (!sequenceId) return undefined;
  return `plop ${sequenceId}`;
}

export class PartialSettlementError extends Error {
  txHash: string;

  constructor(message: string, txHash: string, cause?: unknown) {
    super(message);
    this.name = 'PartialSettlementError';
    this.txHash = txHash;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

type WalletsHandle = ReturnType<ReturnType<BitGoAPI['coin']>['wallets']>;

let walletPromise: Promise<WalletsHandle> | null = null;
let bitgoInstance: BitGoAPI | null = null;

async function getWallet() {
  if (walletPromise) {
    const wallets = await walletPromise;
    return wallets;
  }

  const accessToken = requireEnv('BITGO_ACCESS_TOKEN');
  const coinName = process.env.BITGO_WALLET_COIN || 'hteth';
  const bitgo = new BitGoAPI({ env: 'test' });
  bitgo.register('teth', Teth.createInstance);
  bitgo.register('hteth', Hteth.createInstance);
  await bitgo.authenticateWithAccessToken({ accessToken });
  bitgoInstance = bitgo;
  walletPromise = Promise.resolve(bitgo.coin(coinName).wallets());
  return walletPromise;
}

async function getWalletInstance() {
  const walletId = requireEnv('BITGO_WALLET_ID');
  const wallets = await getWallet();
  return wallets.get({ id: walletId });
}

export async function whitelistBothAddresses(addressA: string, addressB: string): Promise<void> {
  const ruleId = requireEnv('WHITELIST_POLICY_ID');
  const targets = Array.from(
    new Set([addressA, addressB].map((address) => address.trim()))
  );

  const wallet = await getWalletInstance();
  const updatePolicyRule = (wallet as { updatePolicyRule?: (params: unknown) => Promise<unknown> })
    .updatePolicyRule;
  const setPolicyRule = (wallet as { setPolicyRule?: (params: unknown) => Promise<unknown> })
    .setPolicyRule;

  if (typeof updatePolicyRule === 'function' || typeof setPolicyRule === 'function') {
    for (const address of targets) {
      const params = {
        id: ruleId,
        type: 'advancedWhitelist',
        condition: { add: { type: 'address', item: address } },
        action: { type: 'deny' },
      };
      try {
        if (typeof updatePolicyRule === 'function') {
          await updatePolicyRule.call(wallet, params);
        } else if (typeof setPolicyRule === 'function') {
          await setPolicyRule.call(wallet, params);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.toLowerCase().includes('already exists')) {
          throw err;
        }
      }
    }
  } else {
    await updateWhitelistRuleViaApi(ruleId, targets);
  }

  const waitMs = Number(process.env.BITGO_WHITELIST_WAIT_MS || 2000);
  if (Number.isFinite(waitMs) && waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function updateWhitelistRuleViaApi(ruleId: string, addresses: string[]): Promise<void> {
  const accessToken = requireEnv('BITGO_ACCESS_TOKEN');
  const walletId = requireEnv('BITGO_WALLET_ID');
  const coinName = process.env.BITGO_WALLET_COIN || 'hteth';
  const baseUrl = process.env.BITGO_BASE_URL || 'https://app.bitgo-test.com';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  for (const address of addresses) {
    const updateBody = {
      id: ruleId,
      type: 'advancedWhitelist',
      condition: { add: { type: 'address', item: address } },
      action: { type: 'deny' },
    };
    const updateRes = await fetch(`${baseUrl}/api/v2/${coinName}/wallet/${walletId}/policy/rule`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updateBody),
    });
    if (!updateRes.ok) {
      const body = await updateRes.text().catch(() => '');
      if (!body.toLowerCase().includes('already exists')) {
        throw new Error(`[BitGo] Failed to update whitelist (${updateRes.status}): ${body.slice(0, 200)}`);
      }
    }
  }
}

async function sendEthMany(
  addressA: string,
  addressB: string,
  amountWei: string,
  context?: TransferContext
): Promise<string[]> {
  const walletPassphrase = requireEnv('BITGO_WALLET_PASSPHRASE');
  const wallet = await getWalletInstance();
  await wallet.refresh();

  try {
    const spendable = BigInt(wallet.spendableBalanceString());
    const required = BigInt(amountWei) * 2n;
    if (spendable < required) {
      throw new Error(
        `[BitGo] Insufficient spendable balance. Need ${required.toString()} wei, have ${spendable.toString()} wei`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[BitGo] Insufficient spendable balance')) {
      throw err;
    }
  }

  const result = await wallet.sendMany({
    recipients: [
      { address: addressA, amount: amountWei },
      { address: addressB, amount: amountWei },
    ],
    walletPassphrase,
    type: 'transfer',
    sequenceId: context?.sequenceId,
    comment: context?.comment,
  });

  const txHash = result?.txid || result?.hash || result?.id;
  if (!txHash) throw new Error('[BitGo] Missing tx hash from sendMany');
  return [String(txHash)];
}

async function sendEthSingle(
  address: string,
  amountWei: string,
  context?: TransferContext
): Promise<string> {
  const walletPassphrase = requireEnv('BITGO_WALLET_PASSPHRASE');
  const wallet = await getWalletInstance();
  await wallet.refresh();

  const result = await wallet.send({
    address,
    amount: amountWei,
    walletPassphrase,
    type: 'transfer',
    sequenceId: context?.sequenceId,
    comment: context?.comment,
  });
  const txHash = result?.txid || result?.hash || result?.id;
  if (!txHash) throw new Error('[BitGo] Missing tx hash from send');
  return String(txHash);
}

async function sendToken(
  address: string,
  amount: string,
  tokenName: string,
  context?: TransferContext
): Promise<string> {
  const walletPassphrase = requireEnv('BITGO_WALLET_PASSPHRASE');
  const wallet = await getWalletInstance();
  await wallet.refresh();

  const result = await wallet.send({
    address,
    amount,
    walletPassphrase,
    tokenName,
    type: 'transfer',
    sequenceId: context?.sequenceId,
    comment: context?.comment,
  });
  const txHash = result?.txid || result?.hash || result?.id;
  if (!txHash) throw new Error('[BitGo] Missing tx hash from token send');
  return String(txHash);
}

export async function settleEthOnly(
  addressA: string,
  addressB: string,
  amountWei: string,
  context?: { orderAId: string; orderBId: string }
): Promise<SettlementResult> {
  await whitelistBothAddresses(addressA, addressB);
  const sequenceId = context ? buildMatchSequenceId(context.orderAId, context.orderBId) : undefined;
  const txHashes = await sendEthMany(addressA, addressB, amountWei, {
    sequenceId,
    comment: buildComment(sequenceId),
  });
  return { txHashes };
}

export function isEthOnlyPair(tokenIn: string, tokenOut: string): boolean {
  return normalizeToken(tokenIn) === 'eth' && normalizeToken(tokenOut) === 'eth';
}

export async function settleTokenPair(
  tokenIn: string,
  tokenOut: string,
  addressA: string,
  addressB: string,
  amountWei: string,
  context?: { orderAId: string; orderBId: string }
): Promise<SettlementResult> {
  await whitelistBothAddresses(addressA, addressB);

  const tokenInName = resolveTokenName(tokenIn);
  const tokenOutName = resolveTokenName(tokenOut);
  let txHash1: string;
  const sequenceA = context ? buildMatchSequenceId(context.orderAId, context.orderBId, 'A') : undefined;
  const sequenceB = context ? buildMatchSequenceId(context.orderAId, context.orderBId, 'B') : undefined;

  try {
    if (normalizeToken(tokenOut) === 'eth') {
      txHash1 = await sendEthSingle(addressA, amountWei, {
        sequenceId: sequenceA,
        comment: buildComment(sequenceA),
      });
    } else {
      txHash1 = await sendToken(addressA, amountWei, tokenOutName, {
        sequenceId: sequenceA,
        comment: buildComment(sequenceA),
      });
    }
  } catch (err) {
    console.error('[Settlement] FATAL — ERC-20 send #1 failed:', err);
    throw err;
  }

  try {
    let txHash2: string;
    if (normalizeToken(tokenIn) === 'eth') {
      txHash2 = await sendEthSingle(addressB, amountWei, {
        sequenceId: sequenceB,
        comment: buildComment(sequenceB),
      });
    } else {
      txHash2 = await sendToken(addressB, amountWei, tokenInName, {
        sequenceId: sequenceB,
        comment: buildComment(sequenceB),
      });
    }
    return { txHashes: [txHash1, txHash2] };
  } catch (err) {
    console.error('[Settlement] FATAL — send #2 failed after send #1 confirmed:', {
      txHash1,
      addressA,
      addressB,
      error: err,
    });
    throw new PartialSettlementError(
      '[Settlement] ERC-20 second send failed after first confirmed',
      txHash1,
      err
    );
  }
}

export async function refundDeposit(
  refundAddress: string,
  amountWei: string,
  tokenIn: string,
  orderId?: string
): Promise<string> {
  await whitelistBothAddresses(refundAddress, refundAddress);

  if (normalizeToken(tokenIn) === 'eth') {
    const sequenceId = orderId ? buildRefundSequenceId(orderId) : undefined;
    return sendEthSingle(refundAddress, amountWei, {
      sequenceId,
      comment: buildComment(sequenceId),
    });
  }

  const tokenName = resolveTokenName(tokenIn);
  const sequenceId = orderId ? buildRefundSequenceId(orderId) : undefined;
  return sendToken(refundAddress, amountWei, tokenName, {
    sequenceId,
    comment: buildComment(sequenceId),
  });
}

export async function createDepositAddress(label: string): Promise<string> {
  const wallet = await getWalletInstance();
  const result = await wallet.createAddress({ label });
  if (!result?.address) throw new Error('[BitGo] Missing address from createAddress');
  return result.address;
}

export function getBitgoClient(): BitGoAPI {
  if (!bitgoInstance) {
    bitgoInstance = new BitGoAPI({ env: 'test' });
    bitgoInstance.register('teth', Teth.createInstance);
    bitgoInstance.register('hteth', Hteth.createInstance);
  }
  return bitgoInstance;
}

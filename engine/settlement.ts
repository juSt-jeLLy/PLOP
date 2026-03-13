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
  const wallet = await getWalletInstance();
  const ruleId = process.env.WHITELIST_POLICY_ID || 'plop-destination-whitelist';

  try {
    await wallet.setPolicyRule({
      id: ruleId,
      type: 'advancedWhitelist',
      condition: { add: { type: 'address', item: addressA } },
      action: { type: 'deny' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('already exists')) {
      throw err;
    }
  }

  try {
    await wallet.setPolicyRule({
      id: ruleId,
      type: 'advancedWhitelist',
      condition: { add: { type: 'address', item: addressB } },
      action: { type: 'deny' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('already exists')) {
      throw err;
    }
  }

  const waitMs = Number(process.env.BITGO_WHITELIST_WAIT_MS || 2000);
  if (Number.isFinite(waitMs) && waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function sendEthMany(
  addressA: string,
  addressB: string,
  amountWei: string
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
  });

  const txHash = result?.txid || result?.hash || result?.id;
  if (!txHash) throw new Error('[BitGo] Missing tx hash from sendMany');
  return [String(txHash)];
}

async function sendEthSingle(address: string, amountWei: string): Promise<string> {
  const walletPassphrase = requireEnv('BITGO_WALLET_PASSPHRASE');
  const wallet = await getWalletInstance();
  await wallet.refresh();

  const result = await wallet.send({
    address,
    amount: amountWei,
    walletPassphrase,
    type: 'transfer',
  });
  const txHash = result?.txid || result?.hash || result?.id;
  if (!txHash) throw new Error('[BitGo] Missing tx hash from send');
  return String(txHash);
}

async function sendToken(
  address: string,
  amount: string,
  tokenName: string
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
  });
  const txHash = result?.txid || result?.hash || result?.id;
  if (!txHash) throw new Error('[BitGo] Missing tx hash from token send');
  return String(txHash);
}

export async function settleEthOnly(
  addressA: string,
  addressB: string,
  amountWei: string
): Promise<SettlementResult> {
  await whitelistBothAddresses(addressA, addressB);
  const txHashes = await sendEthMany(addressA, addressB, amountWei);
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
  amountWei: string
): Promise<SettlementResult> {
  await whitelistBothAddresses(addressA, addressB);

  const tokenInName = resolveTokenName(tokenIn);
  const tokenOutName = resolveTokenName(tokenOut);
  let txHash1: string;

  try {
    if (normalizeToken(tokenOut) === 'eth') {
      txHash1 = await sendEthSingle(addressA, amountWei);
    } else {
      txHash1 = await sendToken(addressA, amountWei, tokenOutName);
    }
  } catch (err) {
    console.error('[Settlement] FATAL — ERC-20 send #1 failed:', err);
    throw err;
  }

  try {
    let txHash2: string;
    if (normalizeToken(tokenIn) === 'eth') {
      txHash2 = await sendEthSingle(addressB, amountWei);
    } else {
      txHash2 = await sendToken(addressB, amountWei, tokenInName);
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

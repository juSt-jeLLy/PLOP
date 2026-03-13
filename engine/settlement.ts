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
}

async function sendEthMany(
  addressA: string,
  addressB: string,
  amountWei: string
): Promise<string[]> {
  const walletPassphrase = requireEnv('BITGO_WALLET_PASSPHRASE');
  const wallet = await getWalletInstance();

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

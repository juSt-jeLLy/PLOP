import { createPublicClient, createWalletClient, http, type Address, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { namehash, normalize } from 'viem/ens';

const RESOLVER_ABI = [
  {
    type: 'function',
    name: 'setText',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'rotateAddress',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [],
  },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

const rpcUrl = requireEnv('ETH_SEPOLIA_RPC');
const resolverAddress = requireEnv('DARK_POOL_RESOLVER_ADDRESS') as Address;
const enginePrivateKey = (process.env.ENGINE_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY) as
  | `0x${string}`
  | undefined;
if (!enginePrivateKey) {
  throw new Error('[Config] Missing ENGINE_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY');
}

export const ensPublicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

export const ensWalletClient = createWalletClient({
  chain: sepolia,
  transport: http(rpcUrl),
  account: privateKeyToAccount(enginePrivateKey),
});

let ensWriteQueue: Promise<unknown> = Promise.resolve();

async function enqueueEnsWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = ensWriteQueue.then(fn, fn);
  ensWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function waitForPendingNonceClear(timeoutMs = 180000): Promise<void> {
  const account = ensWalletClient.account?.address;
  if (!account) return;
  const maxPending = Number(process.env.ENS_MAX_PENDING || 0);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [latest, pending] = await Promise.all([
      ensPublicClient.getTransactionCount({ address: account, blockTag: 'latest' }),
      ensPublicClient.getTransactionCount({ address: account, blockTag: 'pending' }),
    ]);
    if (pending <= latest + maxPending) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('[ENS] Pending transactions still in flight; wait for confirmations and retry');
}

export function generateSubname(walletAddress: Address): string {
  const prefix = walletAddress.slice(2, 7).toLowerCase();
  return `${prefix}.plop.eth`;
}

export function getEnsNode(ensSubname: string): `0x${string}` {
  return namehash(normalize(ensSubname)) as `0x${string}`;
}

export async function resolveSessionAddress(ensSubname: string): Promise<Address | null> {
  return ensPublicClient.getEnsAddress({ name: normalize(ensSubname) });
}

export async function getTextRecord(ensSubname: string, key: string): Promise<string | null> {
  return ensPublicClient.getEnsText({ name: normalize(ensSubname), key });
}

async function writeWithRetry(
  fn: () => Promise<Hash>,
  label: string,
  maxRetries = 3
): Promise<Hash> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.error(`[ENS] ${label} attempt ${attempt} failed`, err);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  throw new Error(`[ENS] ${label} failed after ${maxRetries} attempts: ${String(lastError)}`);
}

export async function setTextRecord(
  ensSubname: string,
  key: string,
  value: string,
  options?: { waitForReceipt?: boolean; receiptTimeoutMs?: number }
): Promise<Hash> {
  return enqueueEnsWrite(async () => {
    await waitForPendingNonceClear();
    const node = getEnsNode(ensSubname);
    const txHash = await writeWithRetry(
      () =>
        ensWalletClient.writeContract({
          address: resolverAddress,
          abi: RESOLVER_ABI,
          functionName: 'setText',
          args: [node, key, value],
        }),
      `setText(${key})`
    );
    const waitForReceipt = options?.waitForReceipt ?? true;
    const receiptTimeoutMs = options?.receiptTimeoutMs ?? 180000;
    if (waitForReceipt) {
      await ensPublicClient.waitForTransactionReceipt({ hash: txHash, timeout: receiptTimeoutMs });
    }
    return txHash;
  });
}

export async function setSessionMetadata(
  ensSubname: string,
  records: Record<string, string>,
  options?: { waitForReceipt?: boolean; receiptTimeoutMs?: number }
): Promise<Hash[]> {
  const hashes: Hash[] = [];
  for (const [key, value] of Object.entries(records)) {
    const txHash = await setTextRecord(ensSubname, key, value, options);
    hashes.push(txHash);
  }
  return hashes;
}

export async function rotateSessionAddress(ensSubname: string): Promise<Hash> {
  return enqueueEnsWrite(async () => {
    await waitForPendingNonceClear();
    const node = getEnsNode(ensSubname);
    const txHash = await writeWithRetry(
      () =>
        ensWalletClient.writeContract({
          address: resolverAddress,
          abi: RESOLVER_ABI,
          functionName: 'rotateAddress',
          args: [node],
        }),
      'rotateAddress'
    );
    await ensPublicClient.waitForTransactionReceipt({ hash: txHash, timeout: 180000 });
    return txHash;
  });
}

import { type Address, type Hash } from 'viem';

import { ensPublicClient, ensWalletClient, getEnsNode } from './session.js';

const CONTROLLER_ABI = [
  {
    type: 'function',
    name: 'recordSettlement',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'payload', type: 'string' },
      { name: 'expiry', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

let settlementWriteQueue: Promise<unknown> = Promise.resolve();

async function enqueueSettlementWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = settlementWriteQueue.then(fn, fn);
  settlementWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function waitForPendingNonceClear(timeoutMs = 180000): Promise<void> {
  const account = ensWalletClient.account?.address;
  if (!account) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [latest, pending] = await Promise.all([
      ensPublicClient.getTransactionCount({ address: account, blockTag: 'latest' }),
      ensPublicClient.getTransactionCount({ address: account, blockTag: 'pending' }),
    ]);
    if (pending <= latest) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('[Settlement] Pending transactions still in flight; wait and retry');
}

export async function recordSettlementInstruction(options: {
  ensSubname: string;
  payload: string;
  expiry: number;
  nonce: string;
  signature: string;
}): Promise<Hash> {
  return enqueueSettlementWrite(async () => {
    if (!options.payload.startsWith('plop:v1:')) {
      throw new Error('[Settlement] Payload must start with plop:v1:');
    }
    const controllerAddress = requireEnv('SETTLEMENT_CONTROLLER_ADDRESS') as Address;
    const node = getEnsNode(options.ensSubname);
    const expiry = BigInt(options.expiry);
    const nonce = options.nonce as `0x${string}`;
    const signature = options.signature as `0x${string}`;

    await waitForPendingNonceClear();
    const hash = await ensWalletClient.writeContract({
      address: controllerAddress,
      abi: CONTROLLER_ABI,
      functionName: 'recordSettlement',
      args: [node, options.payload, expiry, nonce, signature],
    });

    await ensPublicClient.waitForTransactionReceipt({ hash, timeout: 180000 });
    return hash;
  });
}

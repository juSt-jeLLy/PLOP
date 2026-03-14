import { type Address, type Hash } from 'viem';

import { ensPublicClient, ensWalletClient, getEnsNode, waitForPendingNonceClear, withEnsWriteLock } from './session.js';

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

export async function recordSettlementInstruction(options: {
  ensSubname: string;
  payload: string;
  expiry: number;
  nonce: string;
  signature: string;
}): Promise<Hash> {
  return withEnsWriteLock(async () => {
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

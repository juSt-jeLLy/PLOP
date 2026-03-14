import 'dotenv/config';
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const DEFAULT_ARTIFACT_PATHS = [
  'artifacts/contracts/SettlementController.sol/SettlementController.json',
  'out/SettlementController.sol/SettlementController.json',
];

const RESOLVER_ABI = [
  {
    type: 'function',
    name: 'setSettlementController',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'controller', type: 'address' }],
    outputs: [],
  },
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function resolveArtifactPath() {
  const fromEnv = process.env.SETTLEMENT_CONTROLLER_ARTIFACT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of DEFAULT_ARTIFACT_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    '[Artifact] SettlementController artifact not found. Set SETTLEMENT_CONTROLLER_ARTIFACT_PATH or compile first.'
  );
}

function loadArtifact() {
  const artifactPath = resolveArtifactPath();
  const raw = fs.readFileSync(artifactPath, 'utf8');
  const artifact = JSON.parse(raw);
  if (!artifact?.abi) throw new Error(`[Artifact] Missing abi in ${artifactPath}`);
  let bytecode;
  if (typeof artifact.bytecode === 'string') {
    bytecode = artifact.bytecode;
  } else if (artifact.bytecode && typeof artifact.bytecode.object === 'string') {
    bytecode = artifact.bytecode.object;
  }
  if (!bytecode) throw new Error(`[Artifact] Missing bytecode in ${artifactPath}`);
  const normalized = bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`;
  return { abi: artifact.abi, bytecode: normalized };
}

async function main() {
  const rpcUrl = requireEnv('ETH_SEPOLIA_RPC');
  const resolverAddress = requireEnv('DARK_POOL_RESOLVER_ADDRESS');
  const deployerKey = requireEnv('DEPLOYER_PRIVATE_KEY');
  const engineKey = process.env.ENGINE_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;

  const { abi, bytecode } = loadArtifact();
  const account = privateKeyToAccount(deployerKey);

  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [resolverAddress],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error('[Deploy] Missing contractAddress in receipt');

  console.log('SettlementController deployed');
  console.log('txHash:', hash);
  console.log('address:', receipt.contractAddress);

  if (!engineKey) {
    console.log('ENGINE_PRIVATE_KEY missing; skipping resolver linkage.');
    return;
  }

  const engineAccount = privateKeyToAccount(engineKey);
  const engineClient = createWalletClient({
    account: engineAccount,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const linkHash = await engineClient.writeContract({
    address: resolverAddress,
    abi: RESOLVER_ABI,
    functionName: 'setSettlementController',
    args: [receipt.contractAddress],
  });
  await publicClient.waitForTransactionReceipt({ hash: linkHash });
  console.log('Resolver linked to SettlementController:', receipt.contractAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

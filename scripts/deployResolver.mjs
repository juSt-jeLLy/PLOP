import 'dotenv/config';
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const DEFAULT_ARTIFACT_PATHS = [
  'artifacts/contracts/DarkPoolResolver.sol/DarkPoolResolver.json',
  'out/DarkPoolResolver.sol/DarkPoolResolver.json',
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[Config] Missing ${name}`);
  }
  return value;
}

function resolveArtifactPath() {
  const fromEnv = process.env.DARK_POOL_RESOLVER_ARTIFACT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  for (const candidate of DEFAULT_ARTIFACT_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    '[Artifact] DarkPoolResolver artifact not found. Set DARK_POOL_RESOLVER_ARTIFACT_PATH or compile with hardhat/forge.'
  );
}

function loadArtifact() {
  const artifactPath = resolveArtifactPath();
  const raw = fs.readFileSync(artifactPath, 'utf8');
  const artifact = JSON.parse(raw);

  if (!artifact?.abi) {
    throw new Error(`[Artifact] Missing abi in ${artifactPath}`);
  }

  let bytecode;
  if (typeof artifact.bytecode === 'string') {
    bytecode = artifact.bytecode;
  } else if (artifact.bytecode && typeof artifact.bytecode.object === 'string') {
    bytecode = artifact.bytecode.object;
  }

  if (!bytecode) {
    throw new Error(`[Artifact] Missing bytecode in ${artifactPath}`);
  }

  const normalized = bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`;

  return { abi: artifact.abi, bytecode: normalized };
}

async function main() {
  const rpcUrl = requireEnv('ETH_SEPOLIA_RPC');
  const privateKey = requireEnv('DEPLOYER_PRIVATE_KEY');
  const engineAddress = requireEnv('ENGINE_ADDRESS');

  const { abi, bytecode } = loadArtifact();
  const account = privateKeyToAccount(privateKey);

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [engineAddress],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error('[Deploy] Missing contractAddress in receipt');
  }

  console.log('DarkPoolResolver deployed');
  console.log('txHash:', hash);
  console.log('address:', receipt.contractAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

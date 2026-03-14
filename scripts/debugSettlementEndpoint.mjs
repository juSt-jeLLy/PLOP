import 'dotenv/config';
import nacl from 'tweetnacl';
import { randomBytes } from 'node:crypto';
import { createWalletClient, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { namehash, normalize } from 'viem/ens';
import { sepolia } from 'viem/chains';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function encodeBase64(value) {
  return Buffer.from(value).toString('base64');
}

function decodeBase64(value) {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function randomHex32() {
  return `0x${randomBytes(32).toString('hex')}`;
}

function buildEncryptedSettlementPayload(payload, enginePublicKeyB64) {
  const enginePublicKey = decodeBase64(enginePublicKeyB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ephemeral = nacl.box.keyPair();
  const encrypted = nacl.box(
    Buffer.from(JSON.stringify(payload), 'utf8'),
    nonce,
    enginePublicKey,
    ephemeral.secretKey
  );
  const envelope = {
    encryptedB64: encodeBase64(encrypted),
    nonceB64: encodeBase64(nonce),
    ephemeralPublicKeyB64: encodeBase64(ephemeral.publicKey),
  };
  return `plop:v1:${Buffer.from(JSON.stringify(envelope)).toString('base64')}`;
}

async function main() {
  const engineUrl = requireEnv('ENGINE_URL').replace(/\/+$/, '');
  const controllerAddress = requireEnv('SETTLEMENT_CONTROLLER_ADDRESS');
  const enginePublicKeyB64 = requireEnv('ENGINE_PUBLIC_KEY');
  const ensSubname = process.env.DEBUG_ENS_SUBNAME || 'debug.plop.eth';

  const signerKey =
    process.env.SETTLEMENT_SIGNER_PRIVATE_KEY ||
    process.env.HOODI_FUNDING_PRIVATE_KEY ||
    process.env.ENGINE_PRIVATE_KEY ||
    process.env.DEPLOYER_PRIVATE_KEY;

  if (!signerKey) throw new Error('[Config] Missing signer key');

  const signer = privateKeyToAccount(signerKey);
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const nonce = randomHex32();
  const payload = buildEncryptedSettlementPayload(
    { recipient: signer.address, chainId: 560048, expiry, nonce },
    enginePublicKeyB64
  );
  const payloadHash = keccak256(toBytes(payload));
  const node = namehash(normalize(ensSubname));

  const walletClient = createWalletClient({ account: signer, chain: sepolia, transport: http(requireEnv('ETH_SEPOLIA_RPC')) });
  const signature = await walletClient.signTypedData({
    account: signer,
    domain: {
      name: 'PlopSettlementController',
      version: '1',
      chainId: sepolia.id,
      verifyingContract: controllerAddress,
    },
    types: {
      SettlementAuthorization: [
        { name: 'node', type: 'bytes32' },
        { name: 'payloadHash', type: 'bytes32' },
        { name: 'expiry', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'SettlementAuthorization',
    message: {
      node,
      payloadHash,
      expiry: BigInt(expiry),
      nonce,
    },
  });

  const res = await fetch(`${engineUrl}/session/settlement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ensSubname,
      payload,
      expiry,
      nonce,
      signature,
    }),
  });
  const text = await res.text();
  console.log('[Debug] Engine response', res.status, text.slice(0, 500));
}

main().catch((err) => {
  console.error('[Debug] Failed', err);
  process.exit(1);
});

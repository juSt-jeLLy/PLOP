import nacl from 'tweetnacl';

import type { EncryptedOrderPayload, OrderPayload } from '../types';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

export function getEngineSecretKey(): Uint8Array {
  const secretB64 = requireEnv('ENGINE_SECRET_KEY');
  const secret = decodeBase64(secretB64);
  if (secret.length !== nacl.box.secretKeyLength) {
    throw new Error('[Config] ENGINE_SECRET_KEY length invalid');
  }
  return secret;
}

export function getEnginePublicKey(): Uint8Array {
  const secret = getEngineSecretKey();
  return nacl.box.keyPair.fromSecretKey(secret).publicKey;
}

export function decryptOrderPayload(payload: EncryptedOrderPayload): OrderPayload {
  const secret = getEngineSecretKey();
  const nonce = decodeBase64(payload.nonceB64);
  const senderPublicKey = decodeBase64(payload.ephemeralPublicKeyB64);
  const encrypted = decodeBase64(payload.encryptedB64);

  const decrypted = nacl.box.open(encrypted, nonce, senderPublicKey, secret);
  if (!decrypted) throw new Error('[Crypto] Failed to decrypt order payload');

  const json = Buffer.from(decrypted).toString('utf8');
  return JSON.parse(json) as OrderPayload;
}

export function encryptForRecipient(
  message: string,
  recipientPublicKeyB64: string
): EncryptedOrderPayload {
  const secret = getEngineSecretKey();
  const senderPublicKey = getEnginePublicKey();
  const recipientPublicKey = decodeBase64(recipientPublicKeyB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(Buffer.from(message, 'utf8'), nonce, recipientPublicKey, secret);

  return {
    encryptedB64: encodeBase64(encrypted),
    nonceB64: encodeBase64(nonce),
    ephemeralPublicKeyB64: encodeBase64(senderPublicKey),
  };
}

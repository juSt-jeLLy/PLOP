import crypto from 'crypto';
import type { Address } from 'viem';

import type { EncryptedOrderPayload } from '../types';
import { decryptMessage, encryptForEngine } from './crypto.js';

export type SettlementInstruction = {
  recipient: Address;
  chainId: number;
  tokenOut?: string;
  minAmount?: string;
  expiry?: number;
  nonce: string;
  sessionId?: string;
  orderId?: string;
};

const PREFIX = 'plop:v1:';

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8');
}

export function createSettlementInstruction(
  input: Omit<SettlementInstruction, 'nonce'> & { nonce?: string }
): SettlementInstruction {
  return {
    ...input,
    nonce: input.nonce ?? crypto.randomUUID(),
  };
}

export function encodeSettlementInstruction(instruction: SettlementInstruction): string {
  const encrypted = encryptForEngine(JSON.stringify(instruction));
  const payload = encodeBase64(JSON.stringify(encrypted));
  return `${PREFIX}${payload}`;
}

export function decodeSettlementInstruction(value: string): SettlementInstruction {
  if (!value.startsWith(PREFIX)) {
    throw new Error('[Settlement] Invalid settlement record prefix');
  }
  const encoded = value.slice(PREFIX.length);
  const encrypted = JSON.parse(decodeBase64(encoded)) as EncryptedOrderPayload;
  const json = decryptMessage(encrypted);
  return JSON.parse(json) as SettlementInstruction;
}

export function tryDecodeSettlementInstruction(value: string | null): SettlementInstruction | null {
  if (!value) return null;
  try {
    return decodeSettlementInstruction(value);
  } catch (err) {
    console.warn('[Settlement] Failed to decode settlement instruction', err);
    return null;
  }
}

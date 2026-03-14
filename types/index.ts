export type OrderStatus =
  | 'PENDING_DEPOSIT'
  | 'LIVE'
  | 'IN_SETTLEMENT'
  | 'PARTIALLY_FILLED_IN_SETTLEMENT'
  | 'MATCHED'
  | 'PARTIALLY_FILLED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SETTLEMENT_FAILED'
  | 'PARTIAL_SETTLEMENT';

export type OrderSide = 'BUY' | 'SELL';

export interface EncryptedOrderPayload {
  encryptedB64: string;
  nonceB64: string;
  ephemeralPublicKeyB64: string;
}

export type OrderPayload = {
  tokenIn: string;
  tokenOut: string;
  amount: string;
  limitPrice: string;
  slippageBps?: number;
  ttlSeconds: number;
  type: OrderSide;
  traderPublicKey: string;
  refundAddress?: string;
  depositAddress?: string;
  sessionSubname?: string;
} & Record<string, unknown>;

export interface StoredOrder {
  ddocId: string;
  sessionSubname: string;
  status: OrderStatus;
  encryptedOrder: EncryptedOrderPayload;
  depositAddress?: string;
  originalAmount: string;
  remainingAmount: string;
  filledAmount: string;
  lastFillAmount?: string;
  parentDdocId?: string | null;
  submittedAt: number;
  ttlSeconds: number;
  depositConfirmedAt?: number;
  lastFillAt?: number;
  settledAt?: number;
  settlementTxHash?: string;
  settlementConfirmedTxHashes?: string[];
  settlementError?: string;
  matchedPrice?: number;
  counterpartyEns?: string;
  refundTxHash?: string;
  refundError?: string;
  refundRequestedAt?: number;
  refundCompletedAt?: number;
  refundLastAttemptAt?: number;
}

export interface DecryptedOrder extends OrderPayload {
  ddocId: string;
  subname: string;
  node: `0x${string}`;
  depositAddress?: string;
  parentDdocId: string | null;
  originalAmount: string;
  remainingAmount: string;
  filledAmount: string;
  submittedAt: number;
  ttlSeconds: number;
}

export interface MatchResult {
  orderA: DecryptedOrder;
  orderB: DecryptedOrder;
  fillAmount: bigint;
  matchedPrice: number;
  aFullyFilled: boolean;
  bFullyFilled: boolean;
}

export interface ReceiptPayload {
  orderDdocId: string;
  counterpartyEns: string;
  fillAmount: string;
  matchedPrice: number;
  txHashes: string[];
  timestamp: number;
  originalAmount: string;
  filledAmount: string;
  remainingAmount: string;
  parentDdocId: string | null;
}

export interface SettlementResult {
  txHashes: string[];
}

export interface BitgoWebhookPayload {
  type?: string;
  state?: string;
  transfer?: {
    id?: string;
    state?: string;
    type?: string;
    entries?: Array<{
      address?: string;
      valueString?: string;
      wallet?: string;
      label?: string;
      metadata?: Record<string, string>;
    }>;
  };
}

export type FileverseSyncStatus = 'pending' | 'synced' | 'failed';

export interface FileverseDoc {
  ddocId: string;
  title?: string;
  content?: string | null;
  syncStatus?: FileverseSyncStatus;
  link?: string | null;
}

export interface FileverseCreateResponse {
  data: {
    ddocId: string;
  };
}

export interface FileverseListResponse {
  ddocs: FileverseDoc[];
  total: number;
  hasNext: boolean;
}

export interface FileverseSearchNode {
  ddocId: string;
  content?: string | null;
  title?: string;
}

export interface FileverseSearchResponse {
  nodes: FileverseSearchNode[];
  total: number;
  hasNext: boolean;
}

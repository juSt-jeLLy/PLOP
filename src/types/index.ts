export type OrderType = 'BUY' | 'SELL'
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
  | 'PARTIAL_SETTLEMENT'
export type TokenPair = string
export type OrderTTL = '5min' | '15min' | '1hour'

export interface Order {
  id: string
  type: OrderType
  pair: TokenPair
  amount: number
  price: number
  status: OrderStatus
  ttlSeconds: number
  createdAt: Date
  tokenIn?: string
  tokenOut?: string
}

export interface TradeHistory {
  id: string
  type: OrderType
  pair: TokenPair
  amount: number
  status: OrderStatus
  matchedPrice?: number
  counterpartyEns?: string
  settlementTxHash?: string
  settledAt?: Date
  refundTxHash?: string
  refundRequestedAt?: Date
  refundCompletedAt?: Date
  refundError?: string
  updatedAt: Date
}

export interface SessionIdentity {
  ensSubname: string
  status: 'ACTIVE' | 'ROTATING' | 'INACTIVE'
  sessionNonce: number
  depositAddress?: string | null
}

export type SettlementState = 'AUTHORIZED' | 'REQUIRES_SIGNATURE' | 'SIGNING' | 'ERROR' | 'UNAVAILABLE'

export interface CollateralInfo {
  locked: number
  available: number
  token: string
}

export interface SessionStats {
  tradesCompleted: number
  avgMatchTimeSeconds: number
  totalVolumeUSD: number
}

export interface ActivityEvent {
  id: string
  timestamp: Date
  type: 'NEW_ORDER' | 'MATCH_FOUND' | 'ADDRESS_ROTATED' | 'SETTLEMENT'
  description: string
}

export interface MatchResult {
  orderId: string
  matchedPrice: number
  yourSide: string
  counterpartySide: string
  counterpartyEns: string
  settlementStep: 1 | 2 | 3
}

export interface DepositRequest {
  orderId: string
  depositAddress: string
  amount: number
  token: string
  chainLabel?: string
  side?: OrderType
  pair?: string
}

export interface WalletState {
  connected: boolean
  address: string | null
  chainId?: number
}

export interface ToastMessage {
  id: string
  message: string
  type: 'success' | 'error' | 'info' | 'rotation'
}

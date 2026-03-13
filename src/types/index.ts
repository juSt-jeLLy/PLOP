export type OrderType = 'BUY' | 'SELL'
export type OrderStatus = 'PENDING' | 'MATCHED' | 'SETTLED' | 'CANCELLED'
export type TokenPair = 'ETH/USDC' | 'WBTC/USDC' | 'ETH/WBTC'
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
}

export interface TradeHistory {
  id: string
  type: OrderType
  pair: TokenPair
  amount: number
  matchedPrice: number
  counterpartyEns: string
  settlementTxHash: string
  settledAt: Date
}

export interface SessionIdentity {
  ensSubname: string
  derivedAddress: string
  status: 'ACTIVE' | 'ROTATING' | 'INACTIVE'
  sessionNonce: number
}

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

export interface WalletState {
  connected: boolean
  address: string | null
}

export interface ToastMessage {
  id: string
  message: string
  type: 'success' | 'error' | 'info' | 'rotation'
}

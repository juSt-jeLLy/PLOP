import { Order, TradeHistory } from '@/types'

export const mockActiveOrders: Order[] = [
  { id: 'a7f3...c2e1', type: 'SELL', pair: 'ETH/USDC', amount: 1.5, price: 3240, status: 'PENDING', ttlSeconds: 754, createdAt: new Date() },
  { id: 'b2d8...91fa', type: 'BUY', pair: 'WBTC/USDC', amount: 0.08, price: 62100, status: 'MATCHED', ttlSeconds: 0, createdAt: new Date() },
]

export const mockTradeHistory: TradeHistory[] = [
  { id: 'c9a1...5f3b', type: 'SELL', pair: 'ETH/USDC', amount: 0.5, matchedPrice: 3238, counterpartyEns: 'q9x4r.plop.eth', settlementTxHash: '0xd4f2...8a1b', settledAt: new Date() }
]

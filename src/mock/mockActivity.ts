import { ActivityEvent } from '@/types'

export const mockActivityFeed: ActivityEvent[] = [
  { id: '1', timestamp: new Date(), type: 'NEW_ORDER', description: 'New order — ETH/USDC — Medium' },
  { id: '2', timestamp: new Date(Date.now() - 14000), type: 'MATCH_FOUND', description: 'Match found — WBTC/USDC — 0.08 BTC settled' },
  { id: '3', timestamp: new Date(Date.now() - 38000), type: 'ADDRESS_ROTATED', description: 'Address rotated — p3k9x.plop.eth' },
  { id: '4', timestamp: new Date(Date.now() - 55000), type: 'NEW_ORDER', description: 'New order — ETH/USDC — Small' },
  { id: '5', timestamp: new Date(Date.now() - 90000), type: 'MATCH_FOUND', description: 'Match found — ETH/USDC — 1.5 ETH settled' },
]

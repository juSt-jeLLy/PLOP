import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityEvent, Order, OrderStatus, OrderType, TradeHistory } from '@/types'
import { formatUnits } from 'viem'
import { getTokenDecimals } from '@/lib/tokens'

type EngineOrder = {
  ddocId: string
  sessionSubname?: string
  status: OrderStatus
  tokenIn: string
  tokenOut: string
  type: OrderType
  amount: string
  limitPrice: string
  ttlSeconds: number
  submittedAt: number
  settlementTxHash?: string
  matchedPrice?: number
  counterpartyEns?: string
  settledAt?: number
}

function getEngineUrl() {
  const raw = import.meta.env.VITE_ENGINE_URL as string | undefined
  return (raw || 'http://localhost:3001').replace(/\/+$/, '')
}

function getEngineHeaders() {
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  }
}

function formatTokenAmount(amount: string, token: string): number {
  const decimals = getTokenDecimals(token)
  if (amount.includes('.')) {
    const parsed = Number(amount)
    return Number.isFinite(parsed) ? parsed : 0
  }
  try {
    return Number(formatUnits(BigInt(amount), decimals))
  } catch {
    const parsed = Number(amount)
    return Number.isFinite(parsed) ? parsed : 0
  }
}

function mapEngineOrder(order: EngineOrder): Order {
  const amountIn = formatTokenAmount(order.amount, order.tokenIn)
  const price = Number(order.limitPrice)
  const baseAmount =
    order.type === 'BUY' && Number.isFinite(price) && price > 0
      ? amountIn / price
      : amountIn
  const pair =
    order.type === 'BUY'
      ? `${order.tokenOut}/${order.tokenIn}`
      : `${order.tokenIn}/${order.tokenOut}`

  return {
    id: order.ddocId,
    type: order.type,
    pair,
    amount: Number.isFinite(baseAmount) ? baseAmount : amountIn,
    price: Number.isFinite(price) ? price : 0,
    status: order.status,
    ttlSeconds: order.ttlSeconds,
    createdAt: new Date(order.submittedAt),
    tokenIn: order.tokenIn,
    tokenOut: order.tokenOut,
  }
}

function buildTradeHistory(orders: EngineOrder[]): TradeHistory[] {
  return orders
    .filter((order) => Boolean(order.settledAt))
    .map((order) => {
      const pair =
        order.type === 'BUY'
          ? `${order.tokenOut}/${order.tokenIn}`
          : `${order.tokenIn}/${order.tokenOut}`
      const amountIn = formatTokenAmount(order.amount, order.tokenIn)
      const price = Number(order.limitPrice)
      const baseAmount =
        order.type === 'BUY' && Number.isFinite(price) && price > 0
          ? amountIn / price
          : amountIn
      return {
        id: order.ddocId,
        type: order.type,
        pair,
        amount: Number.isFinite(baseAmount) ? baseAmount : amountIn,
        matchedPrice: Number.isFinite(order.matchedPrice) ? order.matchedPrice : price,
        counterpartyEns: order.counterpartyEns || '—',
        settlementTxHash: order.settlementTxHash || '—',
        settledAt: new Date(order.settledAt || Date.now()),
      }
    })
    .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime())
}

function formatOrderLabel(order: Order) {
  return `${order.type} ${order.amount} ${order.pair}`
}

function statusToEventType(status: OrderStatus): ActivityEvent['type'] {
  if (status === 'IN_SETTLEMENT' || status === 'PARTIALLY_FILLED_IN_SETTLEMENT') {
    return 'MATCH_FOUND'
  }
  if (
    status === 'MATCHED'
    || status === 'PARTIALLY_FILLED'
    || status === 'PARTIAL_SETTLEMENT'
    || status === 'SETTLEMENT_FAILED'
  ) {
    return 'SETTLEMENT'
  }
  return 'NEW_ORDER'
}

function statusLabel(status: OrderStatus): string {
  switch (status) {
    case 'PENDING_DEPOSIT':
      return 'Pending deposit'
    case 'LIVE':
      return 'Live order'
    case 'IN_SETTLEMENT':
    case 'PARTIALLY_FILLED_IN_SETTLEMENT':
      return 'Match found'
    case 'MATCHED':
      return 'Settlement'
    case 'PARTIALLY_FILLED':
      return 'Partial settlement'
    case 'PARTIAL_SETTLEMENT':
      return 'Partial settlement'
    case 'SETTLEMENT_FAILED':
      return 'Settlement failed'
    case 'EXPIRED':
      return 'Expired'
    case 'CANCELLED':
      return 'Cancelled'
    default:
      return status
  }
}

export function usePoolActivity() {
  const [orders, setOrders] = useState<Order[]>([])
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([])
  const seenOrdersRef = useRef(new Map<string, OrderStatus>())
  const seenTradesRef = useRef(new Set<string>())
  const initializedRef = useRef(false)

  const fetchPoolOrders = useCallback(async () => {
    try {
      const res = await fetch(`${getEngineUrl()}/orders/all`, {
        headers: getEngineHeaders(),
      })
      if (!res.ok) {
        console.warn('[Pool] Engine responded', res.status)
        return
      }
      const payload = await res.json()
      const raw = Array.isArray(payload?.orders) ? (payload.orders as EngineOrder[]) : []
      const mapped = raw.map(mapEngineOrder)
      setOrders(mapped)
      setTradeHistory(buildTradeHistory(raw))

      const now = new Date()
      const nextEvents: ActivityEvent[] = []

    if (!initializedRef.current) {
      mapped.forEach((order) => {
        seenOrdersRef.current.set(order.id, order.status)
      })
      raw.forEach((order) => {
        if (order.settledAt) {
          seenTradesRef.current.add(order.ddocId)
        }
      })
      const seeded = [...mapped]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 20)
        .map((order) => ({
          id: `seed-${order.id}`,
          timestamp: order.createdAt,
          type: statusToEventType(order.status),
          description: `${statusLabel(order.status)} — ${formatOrderLabel(order)}`,
        }))
      setEvents(seeded)
      initializedRef.current = true
      return
    }

      mapped.forEach((order) => {
        const prevStatus = seenOrdersRef.current.get(order.id)
        if (!prevStatus) {
          nextEvents.push({
            id: `order-${order.id}-${Date.now()}`,
            timestamp: now,
            type: 'NEW_ORDER',
            description: `New order — ${formatOrderLabel(order)}`,
          })
        } else if (prevStatus !== order.status) {
          if (order.status === 'IN_SETTLEMENT' || order.status === 'PARTIALLY_FILLED_IN_SETTLEMENT') {
            nextEvents.push({
              id: `match-${order.id}-${Date.now()}`,
              timestamp: now,
              type: 'MATCH_FOUND',
              description: `Match found — ${formatOrderLabel(order)}`,
            })
          } else if (order.status === 'MATCHED' || order.status === 'PARTIALLY_FILLED') {
            nextEvents.push({
              id: `settle-${order.id}-${Date.now()}`,
              timestamp: now,
              type: 'SETTLEMENT',
              description: `Settlement — ${formatOrderLabel(order)}`,
            })
          }
        }
        seenOrdersRef.current.set(order.id, order.status)
      })

      raw.forEach((order) => {
        if (!order.settledAt) return
        if (seenTradesRef.current.has(order.ddocId)) return
        seenTradesRef.current.add(order.ddocId)
        nextEvents.push({
          id: `trade-${order.ddocId}-${Date.now()}`,
          timestamp: now,
          type: 'SETTLEMENT',
          description: `Trade settled — ${formatTokenAmount(order.amount, order.tokenIn)} ${order.tokenIn}/${order.tokenOut}`,
        })
      })

      if (nextEvents.length > 0) {
        setEvents((prev) => [...nextEvents, ...prev].slice(0, 50))
      }
    } catch (err) {
      console.warn('[Pool] Failed to fetch orders', err)
    }
  }, [])

  useEffect(() => {
    void fetchPoolOrders()
    const interval = window.setInterval(() => {
      void fetchPoolOrders()
    }, 8000)
    return () => window.clearInterval(interval)
  }, [fetchPoolOrders])

  const depthStats = useMemo(() => {
    const liveOrders = orders.filter((order) => order.status === 'LIVE')
    const buy = liveOrders.filter((order) => order.type === 'BUY')
    const sell = liveOrders.filter((order) => order.type === 'SELL')
    const buyPressure = buy.reduce((sum, order) => sum + order.amount, 0)
    const sellPressure = sell.reduce((sum, order) => sum + order.amount, 0)
    const prices = liveOrders.map((order) => order.price).filter((p) => Number.isFinite(p) && p > 0)
    const midPrice = prices.length > 0 ? prices.reduce((sum, p) => sum + p, 0) / prices.length : 0
    return { buyPressure, sellPressure, midPrice }
  }, [orders])

  const pendingSettlements = useMemo(() => {
    return orders
      .filter((order) => order.status === 'IN_SETTLEMENT' || order.status === 'PARTIALLY_FILLED_IN_SETTLEMENT')
      .map((order) => ({
        orderId: order.id,
        status: order.status,
        side: order.type,
        pair: order.pair,
      }))
  }, [orders])

  return {
    events,
    depthStats,
    pendingSettlements,
    tradeHistory,
  }
}

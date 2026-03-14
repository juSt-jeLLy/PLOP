import { useState, useEffect, useRef } from 'react'
import { ActivityEvent, Order, TradeHistory } from '@/types'

type OrderSnapshot = {
  status: Order['status']
}

function formatOrderLabel(order: Order) {
  return `${order.type} ${order.amount} ${order.pair}`
}

export function useActivityFeed(orders: Order[], history: TradeHistory[]) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const seenOrdersRef = useRef(new Map<string, OrderSnapshot>())
  const seenTradesRef = useRef(new Set<string>())
  const initializedRef = useRef(false)

  useEffect(() => {
    const nextEvents: ActivityEvent[] = []
    const now = new Date()

    if (!initializedRef.current) {
      orders.forEach((order) => {
        seenOrdersRef.current.set(order.id, { status: order.status })
      })
      history.forEach((trade) => {
        seenTradesRef.current.add(trade.id)
      })
      initializedRef.current = true
      return
    }

    orders.forEach((order) => {
      const prev = seenOrdersRef.current.get(order.id)
      if (!prev) {
        nextEvents.push({
          id: `order-${order.id}-${Date.now()}`,
          timestamp: now,
          type: 'NEW_ORDER',
          description: `New order — ${formatOrderLabel(order)}`,
        })
      } else if (prev.status !== order.status) {
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
      seenOrdersRef.current.set(order.id, { status: order.status })
    })

    history.forEach((trade) => {
      if (trade.status !== 'MATCHED' && trade.status !== 'PARTIALLY_FILLED' && trade.status !== 'PARTIAL_SETTLEMENT') {
        return
      }
      if (seenTradesRef.current.has(trade.id)) return
      seenTradesRef.current.add(trade.id)
      nextEvents.push({
        id: `trade-${trade.id}-${Date.now()}`,
        timestamp: now,
        type: 'SETTLEMENT',
        description: `Trade settled — ${trade.amount} ${trade.pair}`,
      })
    })

    if (nextEvents.length > 0) {
      setEvents((prev) => [...nextEvents, ...prev].slice(0, 40))
    }
  }, [orders, history])

  return { events }
}

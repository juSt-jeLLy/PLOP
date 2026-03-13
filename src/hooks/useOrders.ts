import { useState, useCallback } from 'react'
import { Order, TradeHistory, TokenPair, OrderType } from '@/types'
import { mockActiveOrders, mockTradeHistory } from '@/mock/mockOrders'

const hexChars = '0123456789abcdef'
const randomId = () => Array.from({ length: 4 }, () => hexChars[Math.floor(Math.random() * 16)]).join('') + '...' + Array.from({ length: 4 }, () => hexChars[Math.floor(Math.random() * 16)]).join('')

export function useOrders() {
  const [activeOrders, setActiveOrders] = useState<Order[]>(mockActiveOrders)
  const [tradeHistory] = useState<TradeHistory[]>(mockTradeHistory)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSubmitTime, setLastSubmitTime] = useState<number | null>(null)

  const submitOrder = useCallback((data: { type: OrderType; pair: TokenPair; amount: number; price: number; ttlSeconds: number }) => {
    setIsSubmitting(true)
    setTimeout(() => {
      const newOrder: Order = {
        id: randomId(),
        ...data,
        status: 'PENDING',
        createdAt: new Date(),
      }
      setActiveOrders(prev => [newOrder, ...prev])
      setIsSubmitting(false)
      setLastSubmitTime(Date.now())
    }, 1200)
  }, [])

  const cancelOrder = useCallback((id: string) => {
    setActiveOrders(prev => prev.filter(o => o.id !== id))
  }, [])

  return { activeOrders, tradeHistory, submitOrder, cancelOrder, isSubmitting, lastSubmitTime }
}

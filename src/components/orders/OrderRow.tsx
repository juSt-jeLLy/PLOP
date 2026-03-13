import React, { useState, useEffect } from 'react'
import GlassCard from '@/components/ui/GlassCard'
import StatusBadge from '@/components/ui/StatusBadge'
import GradientButton from '@/components/ui/GradientButton'
import { Order } from '@/types'

interface OrderRowProps {
  order: Order
  onCancel: (id: string) => void
}

const OrderRow: React.FC<OrderRowProps> = ({ order, onCancel }) => {
  const [ttl, setTtl] = useState(order.ttlSeconds)
  const [wasMatched, setWasMatched] = useState(false)

  useEffect(() => {
    if (ttl <= 0 || order.status !== 'PENDING') return
    const interval = setInterval(() => setTtl(prev => Math.max(0, prev - 1)), 1000)
    return () => clearInterval(interval)
  }, [ttl, order.status])

  useEffect(() => {
    if (order.status === 'MATCHED') {
      setWasMatched(true)
      const timer = setTimeout(() => setWasMatched(false), 800)
      return () => clearTimeout(timer)
    }
  }, [order.status])

  const mins = Math.floor(ttl / 60)
  const secs = ttl % 60
  const ttlDisplay = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`

  return (
    <GlassCard className={wasMatched ? 'matched-flash' : ''}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="font-mono text-xs text-muted-foreground">{order.id}</span>
        <StatusBadge status={order.status} />
        <span className="font-mono text-sm text-foreground">{order.pair}</span>
        <span className="font-mono text-sm text-foreground">{order.amount}</span>
        <span className="font-mono text-sm text-muted-foreground">${order.price.toLocaleString()}</span>
        <span className="font-mono text-xs text-accent-cyan">{ttlDisplay}</span>
        {order.status === 'PENDING' && (
          <GradientButton variant="danger" size="sm" onClick={() => onCancel(order.id)}>
            Cancel
          </GradientButton>
        )}
      </div>
    </GlassCard>
  )
}

export default OrderRow

import React from 'react'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import type { OrderStatus, OrderType } from '@/types'

interface SettlementQueueProps {
  pendingSettlements: { orderId: string; status: OrderStatus; side: OrderType; pair: string }[]
}

const SettlementQueue: React.FC<SettlementQueueProps> = ({ pendingSettlements }) => {
  return (
    <GlassCard>
      <MonoLabel>Settlement Queue</MonoLabel>
      <div className="mt-3">
        {pendingSettlements.length === 0 ? (
          <div className="text-xs font-mono text-muted-foreground italic">
            No pending settlements
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingSettlements.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="animate-spin w-3 h-3 border border-accent-cyan border-t-transparent rounded-full" />
                <span className="text-muted-foreground font-mono">Awaiting BitGo co-sign...</span>
                <span className="font-mono text-foreground">{s.side}</span>
                <span className="font-mono text-muted-foreground">{s.pair}</span>
                <span className="font-mono text-muted-foreground">#{s.orderId.slice(0, 6)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  )
}

export default SettlementQueue

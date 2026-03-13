import React from 'react'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import AddressDisplay from '@/components/ui/AddressDisplay'

interface SettlementQueueProps {
  pendingSettlements: { fromAddress: string; toAddress: string }[]
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
                <AddressDisplay address={s.fromAddress} truncate />
                <span className="text-muted-foreground">→</span>
                <AddressDisplay address={s.toAddress} truncate />
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  )
}

export default SettlementQueue

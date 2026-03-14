import React from 'react'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import CountUpNumber from '@/components/ui/CountUpNumber'
import { CollateralInfo } from '@/types'

interface CollateralPanelProps {
  collateral: CollateralInfo
}

const CollateralPanel: React.FC<CollateralPanelProps> = ({ collateral }) => {
  const total = collateral.locked + collateral.available
  const ratio = total > 0 ? collateral.locked / total : 0

  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        <MonoLabel>Collateral Locked</MonoLabel>
        <div className="text-2xl font-mono text-accent-green font-semibold">
          <CountUpNumber value={collateral.locked} decimals={2} suffix={` ${collateral.token}`} />
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          Available: {collateral.available} {collateral.token}
        </span>
      </div>
    </GlassCard>
  )
}

export default CollateralPanel

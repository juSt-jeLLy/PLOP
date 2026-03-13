import React from 'react'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import CountUpNumber from '@/components/ui/CountUpNumber'
import { SessionStats } from '@/types'

interface SessionStatsPanelProps {
  stats: SessionStats
}

const SessionStatsPanel: React.FC<SessionStatsPanelProps> = ({ stats }) => {
  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        <MonoLabel>Session Stats</MonoLabel>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground font-mono">Trades Completed</span>
          <span className="text-sm font-mono text-foreground"><CountUpNumber value={stats.tradesCompleted} /></span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground font-mono">Avg Match Time</span>
          <span className="text-sm font-mono text-foreground"><CountUpNumber value={stats.avgMatchTimeSeconds} suffix="s" /></span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground font-mono">Total Volume</span>
          <span className="text-sm font-mono text-foreground"><CountUpNumber value={stats.totalVolumeUSD} prefix="$" /></span>
        </div>
      </div>
    </GlassCard>
  )
}

export default SessionStatsPanel

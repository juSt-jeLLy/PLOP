import React from 'react'
import PulsingDot from './PulsingDot'
import type { OrderStatus } from '@/types'

type BadgeStatus = OrderStatus | 'ACTIVE' | 'ROTATING' | 'INACTIVE'

interface StatusBadgeProps {
  status: BadgeStatus
}

const config: Record<BadgeStatus, { border: string; text: string; dot?: 'green' | 'cyan' | 'yellow' | 'red' | 'purple' }> = {
  PENDING_DEPOSIT: { border: 'border-accent-yellow/50', text: 'text-accent-yellow', dot: 'yellow' },
  LIVE: { border: 'border-accent-green/50', text: 'text-accent-green', dot: 'green' },
  IN_SETTLEMENT: { border: 'border-accent-cyan/50', text: 'text-accent-cyan', dot: 'cyan' },
  PARTIALLY_FILLED_IN_SETTLEMENT: { border: 'border-accent-cyan/50', text: 'text-accent-cyan', dot: 'cyan' },
  PARTIALLY_FILLED: { border: 'border-accent-yellow/50', text: 'text-accent-yellow', dot: 'yellow' },
  MATCHED: { border: 'border-accent-green/50', text: 'text-accent-green', dot: 'green' },
  EXPIRED: { border: 'border-muted-foreground/30', text: 'text-muted-foreground' },
  CANCELLED: { border: 'border-accent-red/50', text: 'text-accent-red' },
  SETTLEMENT_FAILED: { border: 'border-accent-red/50', text: 'text-accent-red' },
  PARTIAL_SETTLEMENT: { border: 'border-accent-yellow/50', text: 'text-accent-yellow' },
  ACTIVE: { border: 'border-accent-green/50', text: 'text-accent-green', dot: 'green' },
  ROTATING: { border: 'border-accent-cyan/50', text: 'text-accent-cyan', dot: 'cyan' },
  INACTIVE: { border: 'border-muted-foreground/30', text: 'text-muted-foreground' },
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const c = config[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono tracking-wider ${c.border} ${c.text}`}>
      {c.dot && <PulsingDot color={c.dot} />}
      {status}
    </span>
  )
}

export default StatusBadge

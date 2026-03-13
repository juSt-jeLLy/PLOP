import React from 'react'
import CountUpNumber from '@/components/ui/CountUpNumber'

interface StatPillsProps {
  ordersLeaked: number
  avgMatchTimeSeconds: number
}

const StatPills: React.FC<StatPillsProps> = ({ ordersLeaked, avgMatchTimeSeconds }) => {
  return (
    <div className="relative z-10 flex flex-wrap items-center justify-center gap-4 mt-8 animate-fade-up" style={{ animationDelay: '400ms' }}>
      <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-accent-green/30 text-accent-green font-mono text-sm">
        <span>🔒</span>
        <CountUpNumber value={ordersLeaked} />
        <span>Orders Leaked</span>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-accent-cyan/30 text-accent-cyan font-mono text-sm">
        <span>⚡ &lt;</span>
        <CountUpNumber value={avgMatchTimeSeconds} />
        <span>s Match Time</span>
      </div>
    </div>
  )
}

export default StatPills

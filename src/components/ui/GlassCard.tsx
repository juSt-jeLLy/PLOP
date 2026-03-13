import React from 'react'

interface GlassCardProps {
  children: React.ReactNode
  className?: string
  hoverable?: boolean
}

const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', hoverable = false }) => {
  return (
    <div
      className={`
        rounded-xl p-5 border
        bg-card/80 backdrop-blur-xl border-border
        ${hoverable ? 'transition-all duration-200 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_0_40px_hsl(var(--accent-purple)/0.4)]' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  )
}

export default GlassCard

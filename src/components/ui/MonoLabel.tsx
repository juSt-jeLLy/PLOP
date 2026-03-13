import React from 'react'

interface MonoLabelProps {
  children: React.ReactNode
  color?: 'muted' | 'cyan' | 'purple' | 'green'
}

const colorMap: Record<string, string> = {
  muted: 'text-muted-foreground',
  cyan: 'text-accent-cyan',
  purple: 'text-accent-purple',
  green: 'text-accent-green',
}

const MonoLabel: React.FC<MonoLabelProps> = ({ children, color = 'muted' }) => {
  return (
    <span className={`font-mono text-[11px] tracking-[0.15em] uppercase ${colorMap[color]}`}>
      {children}
    </span>
  )
}

export default MonoLabel

import React from 'react'

interface PulsingDotProps {
  color: 'green' | 'cyan' | 'yellow' | 'red' | 'purple'
}

const colorMap: Record<string, string> = {
  green: 'bg-accent-green',
  cyan: 'bg-accent-cyan',
  yellow: 'bg-accent-yellow',
  red: 'bg-accent-red',
  purple: 'bg-accent-purple',
}

const PulsingDot: React.FC<PulsingDotProps> = ({ color }) => {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colorMap[color]}`}
      style={{ animation: 'pulseDot 1.5s ease-in-out infinite' }}
    />
  )
}

export default PulsingDot

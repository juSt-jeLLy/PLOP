import React from 'react'
import { TokenPair } from '@/types'
import { getDefaultPairs } from '@/lib/tokens'

interface TokenPairSelectProps {
  value: TokenPair
  onChange: (pair: TokenPair) => void
  disabled?: boolean
}

const TokenPairSelect: React.FC<TokenPairSelectProps> = ({ value, onChange, disabled }) => {
  const pairs = getDefaultPairs() as TokenPair[]
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as TokenPair)}
      disabled={disabled}
      className={`w-full bg-secondary border border-border rounded-lg px-3 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none cursor-pointer ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      {pairs.map(p => (
        <option key={p} value={p} className="bg-card">{p}</option>
      ))}
    </select>
  )
}

export default TokenPairSelect

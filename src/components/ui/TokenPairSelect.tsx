import React from 'react'
import { TokenPair } from '@/types'

interface TokenPairSelectProps {
  value: TokenPair
  onChange: (pair: TokenPair) => void
}

const pairs: TokenPair[] = ['ETH/USDC', 'WBTC/USDC', 'ETH/WBTC']

const TokenPairSelect: React.FC<TokenPairSelectProps> = ({ value, onChange }) => {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as TokenPair)}
      className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none cursor-pointer"
    >
      {pairs.map(p => (
        <option key={p} value={p} className="bg-card">{p}</option>
      ))}
    </select>
  )
}

export default TokenPairSelect

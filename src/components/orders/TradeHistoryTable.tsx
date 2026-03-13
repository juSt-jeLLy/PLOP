import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ExternalLink, ChevronDown } from 'lucide-react'
import GlassCard from '@/components/ui/GlassCard'
import { TradeHistory } from '@/types'

interface TradeHistoryTableProps {
  history: TradeHistory[]
}

const TradeHistoryRow: React.FC<{ trade: TradeHistory }> = ({ trade }) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <GlassCard>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-muted-foreground">{trade.id}</span>
          <span className="font-mono text-sm text-foreground">{trade.pair}</span>
          <span className="font-mono text-sm text-foreground">{trade.amount}</span>
          <span className="font-mono text-sm text-accent-green">${trade.matchedPrice.toLocaleString()}</span>
          <span className="font-mono text-xs text-muted-foreground">{trade.settledAt.toLocaleDateString()}</span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-3 mt-3 border-t border-border flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground font-mono">Counterparty</span>
                <span className="text-xs text-accent-purple font-mono">{trade.counterpartyEns}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground font-mono">Settlement Tx</span>
                <a
                  href={`https://etherscan.io/tx/${trade.settlementTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent-cyan font-mono flex items-center gap-1 hover:underline"
                  onClick={e => e.stopPropagation()}
                >
                  {trade.settlementTxHash}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

const TradeHistoryTable: React.FC<TradeHistoryTableProps> = ({ history }) => {
  if (history.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm font-mono italic">
        No trade history yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {history.map(h => (
        <TradeHistoryRow key={h.id} trade={h} />
      ))}
    </div>
  )
}

export default TradeHistoryTable

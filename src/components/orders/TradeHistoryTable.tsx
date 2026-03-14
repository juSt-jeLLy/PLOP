import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ExternalLink, ChevronDown } from 'lucide-react'
import GlassCard from '@/components/ui/GlassCard'
import { TradeHistory } from '@/types'

interface TradeHistoryTableProps {
  history: TradeHistory[]
}

function formatStatusBadge(trade: TradeHistory) {
  if (trade.refundError && (trade.status === 'CANCELLED' || trade.status === 'EXPIRED')) {
    return { label: 'REFUND FAILED', className: 'border-accent-red/40 text-accent-red' }
  }
  if (trade.refundTxHash && (trade.status === 'CANCELLED' || trade.status === 'EXPIRED')) {
    return { label: 'REFUNDED', className: 'border-accent-green/40 text-accent-green' }
  }
  if (trade.refundRequestedAt && (trade.status === 'CANCELLED' || trade.status === 'EXPIRED')) {
    return { label: 'REFUNDING', className: 'border-accent-yellow/40 text-accent-yellow' }
  }
  switch (trade.status) {
    case 'MATCHED':
      return { label: 'SETTLED', className: 'border-accent-green/40 text-accent-green' }
    case 'PARTIALLY_FILLED':
    case 'PARTIAL_SETTLEMENT':
      return { label: 'PARTIAL', className: 'border-accent-yellow/40 text-accent-yellow' }
    case 'SETTLEMENT_FAILED':
      return { label: 'FAILED', className: 'border-accent-red/40 text-accent-red' }
    case 'CANCELLED':
      return { label: 'CANCELLED', className: 'border-accent-red/40 text-accent-red' }
    case 'EXPIRED':
      return { label: 'EXPIRED', className: 'border-muted-foreground/40 text-muted-foreground' }
    default:
      return { label: trade.status, className: 'border-muted-foreground/40 text-muted-foreground' }
  }
}

function formatDate(value: Date | undefined) {
  if (!value) return '—'
  return value.toLocaleDateString()
}

function isTxHash(value?: string) {
  return Boolean(value && value.startsWith('0x') && value.length > 10)
}

const TradeHistoryRow: React.FC<{ trade: TradeHistory }> = ({ trade }) => {
  const [expanded, setExpanded] = useState(false)
  const badge = formatStatusBadge(trade)
  const priceLabel = typeof trade.matchedPrice === 'number' ? trade.matchedPrice.toLocaleString() : '—'

  return (
    <GlassCard>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-muted-foreground">{trade.id}</span>
          <span className="font-mono text-sm text-foreground">{trade.pair}</span>
          <span className="font-mono text-sm text-foreground">{trade.amount}</span>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-mono tracking-wider ${badge.className}`}
          >
            {badge.label}
          </span>
          <span className="font-mono text-sm text-accent-green">${priceLabel}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {formatDate(trade.updatedAt)}
          </span>
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
                <span className="text-xs text-accent-purple font-mono">{trade.counterpartyEns || '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground font-mono">Settlement Tx</span>
                {isTxHash(trade.settlementTxHash) ? (
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
                ) : (
                  <span className="text-xs text-muted-foreground font-mono">—</span>
                )}
              </div>
              {(trade.refundTxHash || trade.refundRequestedAt || trade.refundError) && (
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground font-mono">Refund Tx</span>
                    {isTxHash(trade.refundTxHash) ? (
                      <a
                        href={`https://etherscan.io/tx/${trade.refundTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-accent-cyan font-mono flex items-center gap-1 hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {trade.refundTxHash}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">
                        {trade.refundRequestedAt ? 'Pending' : '—'}
                      </span>
                    )}
                  </div>
                  {trade.refundError && (
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground font-mono">Refund Error</span>
                      <span className="text-xs text-accent-red font-mono">{trade.refundError}</span>
                    </div>
                  )}
                </div>
              )}
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

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from '@/components/ui/GlassCard'
import { MatchResult } from '@/types'

interface MatchFoundModalProps {
  match: MatchResult | null
  onDismiss: () => void
  onSettlementComplete: () => void
}

const MatchFoundModal: React.FC<MatchFoundModalProps> = ({ match, onDismiss, onSettlementComplete }) => {
  const [step, setStep] = useState(1)

  useEffect(() => {
    if (!match) { setStep(1); return }
    const t1 = setTimeout(() => setStep(2), 1000)
    const t2 = setTimeout(() => setStep(3), 3000)
    const t3 = setTimeout(() => {
      onSettlementComplete()
      setTimeout(onDismiss, 1500)
    }, 4500)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [match, onDismiss, onSettlementComplete])

  return (
    <AnimatePresence>
      {match && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
          >
            <GlassCard className="w-[400px] max-w-[90vw]">
              <div className="flex flex-col items-center gap-5">
                <h2 className="font-syne text-2xl font-bold text-accent-green" style={{ textShadow: '0 0 30px hsl(var(--accent-green) / 0.5)' }}>
                  ✓ MATCH FOUND
                </h2>

                {/* Party circles with connecting line */}
                <svg width="280" height="60" viewBox="0 0 280 60">
                  <circle cx="40" cy="30" r="20" fill="none" stroke="hsl(var(--accent-cyan))" strokeWidth="1.5" />
                  <text x="40" y="34" textAnchor="middle" fill="hsl(var(--text-primary))" fontSize="8" fontFamily="JetBrains Mono">YOU</text>
                  <circle cx="240" cy="30" r="20" fill="none" stroke="hsl(var(--accent-purple))" strokeWidth="1.5" />
                  <text x="240" y="34" textAnchor="middle" fill="hsl(var(--text-primary))" fontSize="7" fontFamily="JetBrains Mono">{match.counterpartyEns.slice(0, 8)}</text>
                  <line x1="60" y1="30" x2="220" y2="30" stroke="hsl(var(--accent-cyan))" strokeWidth="1" strokeDasharray="6 4" style={{ animation: 'strokeDraw 2s linear forwards' }} />
                </svg>

                <div className="text-3xl font-mono gradient-text font-bold">
                  ${match.matchedPrice.toLocaleString()}
                </div>

                <div className="flex flex-col gap-1 text-xs font-mono text-center">
                  <span className="text-muted-foreground">Your side: <span className="text-foreground">{match.yourSide}</span></span>
                  <span className="text-muted-foreground">Counter: <span className="text-accent-purple">{match.counterpartyEns}</span></span>
                </div>

                {/* Step indicators */}
                <div className="flex items-center gap-3">
                  {[1, 2, 3].map(s => (
                    <div key={s} className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono border transition-all duration-300 ${
                        step >= s
                          ? 'bg-accent-green/20 border-accent-green text-accent-green'
                          : step === s - 1
                          ? 'border-accent-cyan text-accent-cyan animate-pulse'
                          : 'border-muted-foreground/30 text-muted-foreground'
                      }`}>
                        {s}
                      </div>
                      {s < 3 && <div className={`w-8 h-px ${step > s ? 'bg-accent-green' : 'bg-muted-foreground/30'}`} />}
                    </div>
                  ))}
                </div>

                <div className="text-[10px] font-mono text-muted-foreground">
                  {step === 1 && 'Verifying match...'}
                  {step === 2 && 'Awaiting BitGo co-sign...'}
                  {step === 3 && 'Settlement complete ✓'}
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default MatchFoundModal

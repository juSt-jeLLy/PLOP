import { useState, useEffect, useCallback } from 'react'
import { MatchResult } from '@/types'

export function useMatchPolling(lastSubmitTime: number | null) {
  const [currentMatch, setCurrentMatch] = useState<MatchResult | null>(null)

  useEffect(() => {
    if (!lastSubmitTime) return
    const timer = setTimeout(() => {
      setCurrentMatch({
        orderId: 'a7f3...c2e1',
        matchedPrice: 3241,
        yourSide: 'SELL 1.5 ETH',
        counterpartySide: 'BUY 1.5 ETH',
        counterpartyEns: 'q9x4r.plop.eth',
        settlementStep: 1,
      })
    }, 5000)
    return () => clearTimeout(timer)
  }, [lastSubmitTime])

  const dismissMatch = useCallback(() => {
    setCurrentMatch(null)
  }, [])

  return { currentMatch, dismissMatch }
}

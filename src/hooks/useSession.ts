import { useState, useCallback } from 'react'
import { SessionIdentity, CollateralInfo, SessionStats } from '@/types'
import { mockSession, mockCollateral, mockStats } from '@/mock/mockSession'

const hexChars = '0123456789abcdef'
const randomHex = (len: number) => Array.from({ length: len }, () => hexChars[Math.floor(Math.random() * 16)]).join('')

export function useSession() {
  const [session, setSession] = useState<SessionIdentity>(mockSession)
  const [collateral] = useState<CollateralInfo>(mockCollateral)
  const [stats] = useState<SessionStats>(mockStats)
  const [isRotating, setIsRotating] = useState(false)

  const rotateAddress = useCallback(() => {
    setIsRotating(true)
    setSession(prev => ({ ...prev, status: 'ROTATING' }))
    setTimeout(() => {
      const newAddr = '0x' + randomHex(32)
      const newEns = randomHex(5) + '.plop.eth'
      setSession(prev => ({
        ...prev,
        derivedAddress: newAddr,
        ensSubname: newEns,
        status: 'ACTIVE',
        sessionNonce: prev.sessionNonce + 1,
      }))
      setIsRotating(false)
    }, 1500)
  }, [])

  return { session, collateral, stats, rotateAddress, isRotating }
}

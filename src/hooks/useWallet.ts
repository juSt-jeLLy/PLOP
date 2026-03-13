import { useState, useCallback } from 'react'
import { WalletState } from '@/types'

export function useWallet() {
  const [walletState, setWalletState] = useState<WalletState>({
    connected: false,
    address: null,
  })

  const connectWallet = useCallback(() => {
    setWalletState({ connected: true, address: '0x4a3f...9c21' })
  }, [])

  const disconnectWallet = useCallback(() => {
    setWalletState({ connected: false, address: null })
  }, [])

  return { walletState, connectWallet, disconnectWallet }
}

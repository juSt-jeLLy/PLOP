import { useState, useCallback, useEffect, useRef } from 'react'
import { createWalletClient, custom } from 'viem'
import { WalletState } from '@/types'

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

const SEPOLIA_CHAIN_ID = 11155111

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`
}

function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null
  const provider = (window as { ethereum?: EthereumProvider }).ethereum
  return provider ?? null
}

async function getChainId(provider: EthereumProvider): Promise<number | undefined> {
  try {
    const hex = await provider.request({ method: 'eth_chainId' })
    if (typeof hex === 'string') return Number.parseInt(hex, 16)
  } catch {
    // ignore chain id failures
  }
  return undefined
}

async function ensureSepolia(provider: EthereumProvider): Promise<boolean> {
  const current = await getChainId(provider)
  if (current === SEPOLIA_CHAIN_ID) return true

  const chainIdHex = toHexChainId(SEPOLIA_CHAIN_ID)
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
    return true
  } catch (err) {
    const code = (err as { code?: number }).code
    if (code !== 4902) {
      console.warn('[Wallet] Failed to switch to Sepolia', err)
      return false
    }
  }

  const rpcUrl =
    (import.meta.env.VITE_ETH_SEPOLIA_RPC as string | undefined)
    || (import.meta.env.VITE_SEPOLIA_RPC as string | undefined)
    || 'https://rpc.sepolia.org'

  try {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainIdHex,
          chainName: 'Ethereum Sepolia',
          nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: ['https://sepolia.etherscan.io'],
        },
      ],
    })
    return true
  } catch (err) {
    console.warn('[Wallet] Failed to add Sepolia network', err)
    return false
  }
}

async function requestAccountPermission(provider: EthereumProvider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    })
  } catch {
    // Some wallets don't support permissions API; ignore.
  }
}

async function revokeAccountPermission(provider: EthereumProvider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    })
  } catch {
    // Not all wallets support revocation; ignore.
  }
}

export function useWallet() {
  const [walletState, setWalletState] = useState<WalletState>({
    connected: false,
    address: null,
    chainId: undefined,
  })
  const hasRequestedChainRef = useRef(false)

  const connectWallet = useCallback(() => {
    const provider = getEthereumProvider()
    if (!provider) {
      console.warn('[Wallet] No injected provider found')
      return
    }
    void (async () => {
      hasRequestedChainRef.current = true
      const switched = await ensureSepolia(provider)
      if (!switched) {
        setWalletState({ connected: false, address: null, chainId: await getChainId(provider) })
        return
      }
      await requestAccountPermission(provider)
      const client = createWalletClient({ transport: custom(provider) })
      const addresses = await client.requestAddresses()
      const address = addresses?.[0]
      if (!address) {
        setWalletState({ connected: false, address: null, chainId: undefined })
        return
      }
      const chainId = await getChainId(provider)
      setWalletState({ connected: true, address, chainId })
    })()
  }, [])

  const disconnectWallet = useCallback(() => {
    const provider = getEthereumProvider()
    if (provider) {
      void revokeAccountPermission(provider)
    }
    setWalletState({ connected: false, address: null, chainId: undefined })
  }, [])

  useEffect(() => {
    const provider = getEthereumProvider()
    if (!provider) return

    let active = true

    void (async () => {
      const accounts = await provider.request({ method: 'eth_accounts' })
      if (!active) return
      if (Array.isArray(accounts) && accounts.length > 0 && typeof accounts[0] === 'string') {
        if (!hasRequestedChainRef.current) {
          await ensureSepolia(provider)
        }
        const chainId = await getChainId(provider)
        setWalletState({ connected: true, address: accounts[0], chainId })
      }
    })()

    const handleAccountsChanged = (accounts: unknown) => {
      if (!Array.isArray(accounts) || accounts.length === 0 || typeof accounts[0] !== 'string') {
        setWalletState({ connected: false, address: null, chainId: undefined })
        return
      }
      void (async () => {
        const chainId = await getChainId(provider)
        setWalletState({ connected: true, address: accounts[0], chainId })
      })()
    }

    const handleChainChanged = (chainIdHex: unknown) => {
      if (typeof chainIdHex !== 'string') return
      const chainId = Number.parseInt(chainIdHex, 16)
      setWalletState((prev) => ({ ...prev, chainId }))
    }

    provider.on?.('accountsChanged', handleAccountsChanged)
    provider.on?.('chainChanged', handleChainChanged)

    return () => {
      active = false
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [])

  return { walletState, connectWallet, disconnectWallet }
}

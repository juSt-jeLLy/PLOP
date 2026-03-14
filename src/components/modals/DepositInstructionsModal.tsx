import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import AddressDisplay from '@/components/ui/AddressDisplay'
import GradientButton from '@/components/ui/GradientButton'
import { DepositRequest, OrderStatus } from '@/types'
import { createPublicClient, createWalletClient, custom, defineChain, parseUnits } from 'viem'
import { getTokenAddress, getTokenDecimals } from '@/lib/tokens'

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
}

const HOODI_CHAIN_ID = 560048
const NATIVE_TOKENS = new Set(['ETH', 'HTETH', 'TETH'])

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`
}

function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null
  return (window as { ethereum?: EthereumProvider }).ethereum ?? null
}

function getHoodiChain(rpcUrl?: string) {
  return defineChain({
    id: HOODI_CHAIN_ID,
    name: 'Hoodi',
    nativeCurrency: { name: 'Hoodi ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
    testnet: true,
  })
}

async function ensureHoodi(provider: EthereumProvider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHexChainId(HOODI_CHAIN_ID) }],
    })
    return
  } catch (err) {
    const code = (err as { code?: number }).code
    if (code !== 4902) {
      console.warn('[Deposit] Failed to switch to Hoodi', err)
      throw err
    }
  }

  const rpcUrl =
    (import.meta.env.VITE_ETH_HOODI_RPC as string | undefined)
    || (import.meta.env.VITE_HOODI_RPC as string | undefined)
  if (!rpcUrl) {
    throw new Error('Hoodi network is missing. Set VITE_ETH_HOODI_RPC or add Hoodi in MetaMask.')
  }

  try {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: toHexChainId(HOODI_CHAIN_ID),
          chainName: 'Hoodi',
          nativeCurrency: { name: 'Hoodi ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: [rpcUrl],
        },
      ],
    })
    return
  } catch (err) {
    console.warn('[Deposit] Failed to add Hoodi network', err)
    throw err
  }
}

interface DepositInstructionsModalProps {
  request: DepositRequest | null
  onDismiss: () => void
  orderStatus?: OrderStatus | null
}

const DepositInstructionsModal: React.FC<DepositInstructionsModalProps> = ({ request, onDismiss, orderStatus }) => {
  const [isDepositing, setIsDepositing] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [depositError, setDepositError] = useState<string | null>(null)

  useEffect(() => {
    if (!request) return
    setIsDepositing(false)
    setHasSubmitted(false)
    setTxHash(null)
    setDepositError(null)
  }, [request?.orderId])

  useEffect(() => {
    if (orderStatus === 'LIVE' && hasSubmitted) {
      const timer = window.setTimeout(onDismiss, 1200)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [orderStatus, hasSubmitted, onDismiss])

  const handleDeposit = async () => {
    if (!request) return
    const provider = getEthereumProvider()
    if (!provider) {
      setDepositError('No wallet provider found.')
      return
    }
    setIsDepositing(true)
    setDepositError(null)
    try {
      const rpcUrl =
        (import.meta.env.VITE_ETH_HOODI_RPC as string | undefined)
        || (import.meta.env.VITE_HOODI_RPC as string | undefined)
      const hoodiChain = getHoodiChain(rpcUrl)
      const walletTransport = custom(provider)
      const walletClient = createWalletClient({ transport: walletTransport, chain: hoodiChain })
      const publicClient = createPublicClient({ transport: walletTransport, chain: hoodiChain })
      const accounts = await walletClient.requestAddresses()
      const account = accounts?.[0]
      if (!account) {
        throw new Error('No wallet account available')
      }
      await ensureHoodi(provider)

      const token = request.token.toUpperCase()
      const decimals = getTokenDecimals(token)
      const amountWei = parseUnits(String(request.amount), decimals)

      if (NATIVE_TOKENS.has(token)) {
        let gas: bigint | undefined
        let maxFeePerGas: bigint | undefined
        let maxPriorityFeePerGas: bigint | undefined
        let gasPrice: bigint | undefined
        if (publicClient) {
          try {
            gas = await publicClient.estimateGas({
              account,
              to: request.depositAddress as `0x${string}`,
              value: amountWei,
            })
          } catch {
            gas = undefined
          }
          try {
            const fees = await publicClient.estimateFeesPerGas()
            maxFeePerGas = fees.maxFeePerGas ?? undefined
            maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? undefined
          } catch {
            maxFeePerGas = undefined
            maxPriorityFeePerGas = undefined
          }
          if (!maxFeePerGas || !maxPriorityFeePerGas) {
            try {
              gasPrice = await publicClient.getGasPrice()
            } catch {
              gasPrice = undefined
            }
          }
        }

        const hash = await walletClient.sendTransaction({
          account,
          to: request.depositAddress as `0x${string}`,
          value: amountWei,
          ...(gas ? { gas } : {}),
          ...(maxFeePerGas && maxPriorityFeePerGas
            ? { maxFeePerGas, maxPriorityFeePerGas }
            : gasPrice
              ? { gasPrice }
              : {}),
        })
        setTxHash(hash)
      } else {
        const tokenAddress = getTokenAddress(token)
        if (!tokenAddress) {
          throw new Error(`Token address missing for ${token}`)
        }
        let gas: bigint | undefined
        let maxFeePerGas: bigint | undefined
        let maxPriorityFeePerGas: bigint | undefined
        let gasPrice: bigint | undefined
        if (publicClient) {
          try {
            gas = await publicClient.estimateContractGas({
              account,
              address: tokenAddress as `0x${string}`,
              abi: [
                {
                  name: 'transfer',
                  type: 'function',
                  stateMutability: 'nonpayable',
                  inputs: [
                    { name: 'to', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                  ],
                  outputs: [{ name: '', type: 'bool' }],
                },
              ],
              functionName: 'transfer',
              args: [request.depositAddress as `0x${string}`, amountWei],
            })
          } catch {
            gas = undefined
          }
          try {
            const fees = await publicClient.estimateFeesPerGas()
            maxFeePerGas = fees.maxFeePerGas ?? undefined
            maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? undefined
          } catch {
            maxFeePerGas = undefined
            maxPriorityFeePerGas = undefined
          }
          if (!maxFeePerGas || !maxPriorityFeePerGas) {
            try {
              gasPrice = await publicClient.getGasPrice()
            } catch {
              gasPrice = undefined
            }
          }
        }

        const hash = await walletClient.writeContract({
          account,
          address: tokenAddress as `0x${string}`,
          abi: [
            {
              name: 'transfer',
              type: 'function',
              stateMutability: 'nonpayable',
              inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' },
              ],
              outputs: [{ name: '', type: 'bool' }],
            },
          ],
          functionName: 'transfer',
          args: [request.depositAddress as `0x${string}`, amountWei],
          ...(gas ? { gas } : {}),
          ...(maxFeePerGas && maxPriorityFeePerGas
            ? { maxFeePerGas, maxPriorityFeePerGas }
            : gasPrice
              ? { gasPrice }
              : {}),
        })
        setTxHash(hash)
      }
      setHasSubmitted(true)
    } catch (err) {
      console.warn('[Deposit] MetaMask transfer failed', err)
      const message = err instanceof Error ? err.message : 'Deposit failed. Check your wallet and try again.'
      setDepositError(message)
    } finally {
      setIsDepositing(false)
    }
  }

  return (
    <AnimatePresence>
      {request && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
          >
            <GlassCard className="w-[420px] max-w-[92vw]">
              <div className="flex flex-col gap-4">
                <div className="font-syne text-xl text-accent-green font-semibold">
                  Deposit Required
                </div>
                <div className="text-xs font-mono text-muted-foreground">
                  Send the deposit to activate your order on Hoodi.
                </div>

                <div className="grid gap-2 text-sm">
                  <div>
                    <MonoLabel>Order</MonoLabel>
                    <div className="font-mono text-xs text-muted-foreground">{request.orderId}</div>
                  </div>
                  {request.side && (
                    <div>
                      <MonoLabel>Side</MonoLabel>
                      <div className="font-mono text-base text-foreground">{request.side}</div>
                    </div>
                  )}
                  {request.pair && (
                    <div>
                      <MonoLabel>Pair</MonoLabel>
                      <div className="font-mono text-xs text-muted-foreground">{request.pair}</div>
                    </div>
                  )}
                  <div>
                    <MonoLabel>Amount</MonoLabel>
                    <div className="font-mono text-base text-foreground">
                      {request.amount} {request.token}
                    </div>
                  </div>
                  <div>
                    <MonoLabel>Deposit Address ({request.chainLabel || 'Hoodi'})</MonoLabel>
                    <AddressDisplay address={request.depositAddress} />
                  </div>
                </div>

                <div className="text-[11px] font-mono text-muted-foreground">
                  Deposit from an external wallet. Once confirmed, the order moves to LIVE.
                </div>

                <div className="flex gap-2">
                  <GradientButton
                    variant="primary"
                    size="sm"
                    onClick={handleDeposit}
                    loading={isDepositing}
                    disabled={isDepositing || hasSubmitted}
                  >
                    {orderStatus === 'LIVE'
                      ? 'Deposit Confirmed'
                      : hasSubmitted
                        ? 'Updating...'
                        : isDepositing
                          ? 'Confirm in MetaMask...'
                          : request.side
                            ? `Deposit ${request.side}`
                            : 'Deposit with MetaMask'}
                  </GradientButton>
                  <GradientButton variant="secondary" size="sm" onClick={onDismiss}>
                    Close
                  </GradientButton>
                </div>
                {hasSubmitted && orderStatus !== 'LIVE' && (
                  <div className="text-[11px] font-mono text-muted-foreground">
                    Waiting for Hoodi confirmation…
                  </div>
                )}
                {txHash && (
                  <div className="text-[11px] font-mono text-muted-foreground break-all">
                    Tx: {txHash}
                  </div>
                )}
                {depositError && (
                  <div className="text-[11px] font-mono text-accent-red">
                    {depositError}
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default DepositInstructionsModal

import { useState, useCallback, useEffect, useRef } from 'react'
import nacl from 'tweetnacl'
import { formatUnits, parseUnits } from 'viem'
import { Order, TradeHistory, TokenPair, OrderType, OrderStatus, DepositRequest } from '@/types'
import { getTokenDecimals, parseTokenPair } from '@/lib/tokens'

type UseOrdersOptions = {
  sessionSubname?: string
  enginePublicKey?: string | null
  walletConnected?: boolean
  sessionDepositAddress?: string | null
  walletAddress?: string | null
}

type EngineOrder = {
  ddocId: string
  status: OrderStatus
  tokenIn: string
  tokenOut: string
  type: OrderType
  amount: string
  limitPrice: string
  ttlSeconds: number
  submittedAt: number
  settlementTxHash?: string
  matchedPrice?: number
  counterpartyEns?: string
  settledAt?: number
}

const ACTIVE_STATUSES = new Set<OrderStatus>([
  'PENDING_DEPOSIT',
  'LIVE',
  'IN_SETTLEMENT',
  'PARTIALLY_FILLED_IN_SETTLEMENT',
  'PARTIALLY_FILLED',
])

function getEngineUrl() {
  const raw = import.meta.env.VITE_ENGINE_URL as string | undefined
  return (raw || 'http://localhost:3001').replace(/\/+$/, '')
}

function getEngineHeaders() {
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function formatTokenAmount(amount: string, token: string): number {
  const decimals = getTokenDecimals(token)
  if (amount.includes('.')) {
    const parsed = Number(amount)
    return Number.isFinite(parsed) ? parsed : 0
  }
  try {
    return Number(formatUnits(BigInt(amount), decimals))
  } catch {
    const parsed = Number(amount)
    return Number.isFinite(parsed) ? parsed : 0
  }
}

function mapEngineOrder(order: EngineOrder): Order {
  const amountIn = formatTokenAmount(order.amount, order.tokenIn)
  const price = Number(order.limitPrice)
  const baseAmount =
    order.type === 'BUY' && Number.isFinite(price) && price > 0
      ? amountIn / price
      : amountIn
  const pair =
    order.type === 'BUY'
      ? `${order.tokenOut}/${order.tokenIn}`
      : `${order.tokenIn}/${order.tokenOut}`

  return {
    id: order.ddocId,
    type: order.type,
    pair,
    amount: Number.isFinite(baseAmount) ? baseAmount : amountIn,
    price: Number.isFinite(price) ? price : 0,
    status: order.status,
    ttlSeconds: order.ttlSeconds,
    createdAt: new Date(order.submittedAt),
    tokenIn: order.tokenIn,
    tokenOut: order.tokenOut,
  }
}

function buildPair(order: EngineOrder): string {
  return order.type === 'BUY'
    ? `${order.tokenOut}/${order.tokenIn}`
    : `${order.tokenIn}/${order.tokenOut}`
}

function buildTradeHistory(orders: EngineOrder[]): TradeHistory[] {
  return orders
    .filter((order) => Boolean(order.settledAt))
    .map((order) => {
      const pair =
        order.type === 'BUY'
          ? `${order.tokenOut}/${order.tokenIn}`
          : `${order.tokenIn}/${order.tokenOut}`
      const amountIn = formatTokenAmount(order.amount, order.tokenIn)
      const price = Number(order.limitPrice)
      const baseAmount =
        order.type === 'BUY' && Number.isFinite(price) && price > 0
          ? amountIn / price
          : amountIn
      return {
        id: order.ddocId,
        type: order.type,
        pair,
        amount: Number.isFinite(baseAmount) ? baseAmount : amountIn,
        matchedPrice: Number.isFinite(order.matchedPrice) ? order.matchedPrice : price,
        counterpartyEns: order.counterpartyEns || '—',
        settlementTxHash: order.settlementTxHash || '—',
        settledAt: new Date(order.settledAt || Date.now()),
      }
    })
    .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime())
}

export function useOrders(options: UseOrdersOptions = {}) {
  const {
    sessionSubname,
    enginePublicKey,
    walletConnected = true,
    sessionDepositAddress,
    walletAddress,
  } = options
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSubmitTime, setLastSubmitTime] = useState<number | null>(null)
  const [depositRequest, setDepositRequest] = useState<DepositRequest | null>(null)
  const fetchInFlight = useRef(false)
  const lastPromptedOrderId = useRef<string | null>(null)

  const fetchOrders = useCallback(async () => {
    if (!walletConnected || !sessionSubname || sessionSubname === '—') {
      setActiveOrders([])
      setTradeHistory([])
      setDepositRequest(null)
      return
    }
    if (fetchInFlight.current) return
    fetchInFlight.current = true
    try {
      const url = new URL(`${getEngineUrl()}/orders`)
      url.searchParams.set('sessionSubname', sessionSubname)
      const res = await fetch(url.toString(), { headers: getEngineHeaders() })
      if (!res.ok) {
        console.warn('[Orders] Engine responded', res.status)
        return
      }
      const payload = await res.json()
      const orders = Array.isArray(payload?.orders) ? (payload.orders as EngineOrder[]) : []
      const mapped = orders
        .map(mapEngineOrder)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      const active = mapped.filter((order) => ACTIVE_STATUSES.has(order.status))
      setActiveOrders(active)
      setTradeHistory(buildTradeHistory(orders))

      if (depositRequest) {
        const current = active.find((order) => order.id === depositRequest.orderId)
        if (!current || current.status !== 'PENDING_DEPOSIT') {
          setDepositRequest(null)
        }
      } else if (sessionDepositAddress) {
        const pending = active.find((order) => order.status === 'PENDING_DEPOSIT')
        if (pending && pending.id !== lastPromptedOrderId.current) {
          const raw = orders.find((entry) => entry.ddocId === pending.id)
          if (raw) {
            lastPromptedOrderId.current = pending.id
            const amount = formatTokenAmount(raw.amount, raw.tokenIn)
            setDepositRequest({
              orderId: pending.id,
              depositAddress: sessionDepositAddress,
              amount,
              token: raw.tokenIn,
              chainLabel: 'Hoodi / BitGo',
              side: raw.type,
              pair: buildPair(raw),
            })
          }
        }
      }
    } catch (err) {
      console.warn('[Orders] Failed to fetch orders', err)
    } finally {
      fetchInFlight.current = false
    }
  }, [walletConnected, sessionSubname, depositRequest, sessionDepositAddress])

  useEffect(() => {
    void fetchOrders()
    if (!walletConnected || !sessionSubname || sessionSubname === '—') return undefined
    const interval = window.setInterval(() => {
      void fetchOrders()
    }, 8000)
    return () => window.clearInterval(interval)
  }, [fetchOrders, walletConnected, sessionSubname])

  const submitOrder = useCallback(
    async (data: { type: OrderType; pair: TokenPair; amount: number; price: number; ttlSeconds: number }) => {
      if (!walletConnected || !sessionSubname || sessionSubname === '—') {
        console.warn('[Orders] Wallet not connected; refusing to submit')
        return
      }
      if (!enginePublicKey) {
        console.warn('[Orders] Engine public key unavailable')
        return
      }
      setIsSubmitting(true)
      try {
        const { base, quote } = parseTokenPair(data.pair)
        const tokenIn = data.type === 'SELL' ? base : quote
        const tokenOut = data.type === 'SELL' ? quote : base
        const decimals = getTokenDecimals(tokenIn)
        const amountWei = parseUnits(String(data.amount), decimals).toString()
        const limitPrice = String(data.price)
        const nonce = nacl.randomBytes(nacl.box.nonceLength)
        const ephemeral = nacl.box.keyPair()
        const traderPublicKey = encodeBase64(ephemeral.publicKey)
        const payload = {
          tokenIn,
          tokenOut,
          amount: amountWei,
          limitPrice,
          ttlSeconds: data.ttlSeconds,
          type: data.type,
          traderPublicKey,
          refundAddress: options.walletAddress || undefined,
        }
        const message = new TextEncoder().encode(JSON.stringify(payload))
        const encrypted = nacl.box(message, nonce, decodeBase64(enginePublicKey), ephemeral.secretKey)
        const encryptedOrder = {
          encryptedB64: encodeBase64(encrypted),
          nonceB64: encodeBase64(nonce),
          ephemeralPublicKeyB64: traderPublicKey,
        }

        const res = await fetch(`${getEngineUrl()}/orders`, {
          method: 'POST',
          headers: getEngineHeaders(),
          body: JSON.stringify({
            sessionSubname,
            encryptedOrder,
          }),
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`[Orders] Create failed: ${res.status} ${text}`)
        }
        const created = await res.json()
        const depositAddress =
          typeof created?.depositAddress === 'string'
            ? created.depositAddress
            : sessionDepositAddress || null
        const orderId = typeof created?.ddocId === 'string' ? created.ddocId : '—'
        setLastSubmitTime(Date.now())
        if (depositAddress) {
          lastPromptedOrderId.current = orderId
          setDepositRequest({
            orderId,
            depositAddress,
            amount: data.amount,
            token: tokenIn,
            chainLabel: 'Hoodi / BitGo',
            side: data.type,
            pair: data.pair,
          })
        }
        await fetchOrders()
      } catch (err) {
        console.warn('[Orders] Submit failed', err)
      } finally {
        setIsSubmitting(false)
      }
    },
    [walletConnected, sessionSubname, enginePublicKey, fetchOrders, sessionDepositAddress, walletAddress]
  )

  const cancelOrder = useCallback(
    async (id: string) => {
      if (!id) return
      try {
        const res = await fetch(`${getEngineUrl()}/orders/${id}/cancel`, {
          method: 'POST',
          headers: getEngineHeaders(),
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`[Orders] Cancel failed: ${res.status} ${text}`)
        }
        await fetchOrders()
      } catch (err) {
        console.warn('[Orders] Cancel failed', err)
      }
    },
    [fetchOrders]
  )

  const clearDepositRequest = useCallback(() => {
    setDepositRequest(null)
  }, [])

  return {
    activeOrders,
    tradeHistory,
    submitOrder,
    cancelOrder,
    isSubmitting,
    lastSubmitTime,
    depositRequest,
    clearDepositRequest,
  }
}

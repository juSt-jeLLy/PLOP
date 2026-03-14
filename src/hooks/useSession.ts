import { useState, useCallback, useEffect, useRef } from 'react'
import nacl from 'tweetnacl'
import { createPublicClient, createWalletClient, custom, http, keccak256, toBytes } from 'viem'
import { sepolia } from 'viem/chains'
import { namehash, normalize } from 'viem/ens'
import { SessionIdentity, CollateralInfo, SessionStats, SettlementState } from '@/types'
import { getDefaultPairs } from '@/lib/tokens'

const DEFAULT_SESSION: SessionIdentity = {
  ensSubname: '—',
  derivedAddress: '—',
  status: 'INACTIVE',
  sessionNonce: 0,
  depositAddress: null,
}

const DEFAULT_COLLATERAL: CollateralInfo = {
  locked: 0,
  available: 0,
  token: 'ETH',
}

const DEFAULT_STATS: SessionStats = {
  tradesCompleted: 0,
  avgMatchTimeSeconds: 0,
  totalVolumeUSD: 0,
}

type EngineConfig = {
  enginePublicKey?: string | null
  settlementController?: string | null
  hoodiChainId?: number | null
}

type EngineConfigStatus = 'loading' | 'ready' | 'error'

function getEngineUrl() {
  const raw = import.meta.env.VITE_ENGINE_URL as string | undefined
  return (raw || 'http://localhost:3001').replace(/\/+$/, '')
}

function getEngineHeaders() {
  return {
    'Content-Type': 'application/json',
    // ngrok free plan returns a browser warning HTML unless this header is set.
    'ngrok-skip-browser-warning': 'true',
  }
}

function getSepoliaRpcUrl() {
  return (
    (import.meta.env.VITE_ETH_SEPOLIA_RPC as string | undefined)
    || (import.meta.env.VITE_SEPOLIA_RPC as string | undefined)
    || ''
  )
}

function getEthereumProvider() {
  if (typeof window === 'undefined') return null
  return (window as { ethereum?: { request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown> } }).ethereum ?? null
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

function randomHex32(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

function buildEncryptedSettlementPayload(
  payload: Record<string, unknown>,
  enginePublicKeyB64: string
) {
  const enginePublicKey = decodeBase64(enginePublicKeyB64)
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const ephemeral = nacl.box.keyPair()
  const message = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = nacl.box(message, nonce, enginePublicKey, ephemeral.secretKey)

  const envelope = {
    encryptedB64: encodeBase64(encrypted),
    nonceB64: encodeBase64(nonce),
    ephemeralPublicKeyB64: encodeBase64(ephemeral.publicKey),
  }

  return `plop:v1:${btoa(JSON.stringify(envelope))}`
}

function deriveSubname(walletAddress: string) {
  const prefix = walletAddress.slice(2, 7).toLowerCase()
  return `${prefix}.plop.eth`
}

function getSessionStorageKey(walletAddress: string) {
  return `plop.session.${walletAddress.toLowerCase()}`
}

function loadStoredDeposit(walletAddress: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getSessionStorageKey(walletAddress))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { depositAddress?: string }
    return typeof parsed.depositAddress === 'string' ? parsed.depositAddress : null
  } catch {
    return null
  }
}

function storeDeposit(walletAddress: string, depositAddress: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      getSessionStorageKey(walletAddress),
      JSON.stringify({ depositAddress })
    )
  } catch {
    // ignore storage failures
  }
}

async function getEnsClient() {
  const rpcUrl = getSepoliaRpcUrl()
  if (!rpcUrl) return null
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
}

export function useSession(walletAddress?: string | null) {
  const [session, setSession] = useState<SessionIdentity>(DEFAULT_SESSION)
  const [collateral] = useState<CollateralInfo>(DEFAULT_COLLATERAL)
  const [stats] = useState<SessionStats>(DEFAULT_STATS)
  const [isRotating, setIsRotating] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [engineConfig, setEngineConfig] = useState<EngineConfig | null>(null)
  const [engineConfigStatus, setEngineConfigStatus] = useState<EngineConfigStatus>('loading')
  const [settlementState, setSettlementState] = useState<SettlementState>('UNAVAILABLE')
  const settlementAttemptedRef = useRef(false)
  const settlementInFlightRef = useRef(false)

  const loadEngineConfig = useCallback(async () => {
    setEngineConfigStatus('loading')
    try {
      const res = await fetch(`${getEngineUrl()}/config`, {
        headers: getEngineHeaders(),
      })
      if (!res.ok) {
        setEngineConfigStatus('error')
        return
      }
      const payload = await res.json()
      setEngineConfig({
        enginePublicKey: typeof payload?.enginePublicKey === 'string' ? payload.enginePublicKey : null,
        settlementController: typeof payload?.settlementController === 'string' ? payload.settlementController : null,
        hoodiChainId: typeof payload?.hoodiChainId === 'number' ? payload.hoodiChainId : null,
      })
      setEngineConfigStatus('ready')
    } catch {
      setEngineConfigStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadEngineConfig()
  }, [loadEngineConfig])

  const authorizeSettlement = useCallback(async (ensSubname: string) => {
    if (!walletAddress) return false
    if (!engineConfig?.enginePublicKey || !engineConfig?.settlementController) {
      setSettlementState('UNAVAILABLE')
      return false
    }
    const provider = getEthereumProvider()
    if (!provider) {
      setSettlementState('ERROR')
      setSessionError('[Session] Wallet provider not found for settlement authorization.')
      return false
    }
    setSettlementState('SIGNING')
    try {
      const client = createWalletClient({ transport: custom(provider) })
      const node = namehash(normalize(ensSubname))
      const nonce = randomHex32()
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const settlementPayload = {
        recipient: walletAddress,
        chainId: engineConfig.hoodiChainId ?? 560048,
        expiry,
        nonce,
      }
      const encryptedPayload = buildEncryptedSettlementPayload(
        settlementPayload,
        engineConfig.enginePublicKey
      )
      const payloadHash = keccak256(toBytes(encryptedPayload))
      const signature = await client.signTypedData({
        account: walletAddress as `0x${string}`,
        domain: {
          name: 'PlopSettlementController',
          version: '1',
          chainId: sepolia.id,
          verifyingContract: engineConfig.settlementController as `0x${string}`,
        },
        types: {
          SettlementAuthorization: [
            { name: 'node', type: 'bytes32' },
            { name: 'payloadHash', type: 'bytes32' },
            { name: 'expiry', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'SettlementAuthorization',
        message: {
          node,
          payloadHash,
          expiry: BigInt(expiry),
          nonce,
        },
      })

      const res = await fetch(`${getEngineUrl()}/session/settlement`, {
        method: 'POST',
        headers: getEngineHeaders(),
        body: JSON.stringify({
          ensSubname,
          payload: encryptedPayload,
          expiry,
          nonce,
          signature,
        }),
      })
      if (!res.ok) {
        throw new Error(`Settlement sync failed: ${res.status}`)
      }
      setSettlementState('AUTHORIZED')
      return true
    } catch (err) {
      console.warn('[Session] Settlement authorization failed', err)
      setSettlementState('ERROR')
      setSessionError('[Session] Settlement authorization failed. Please retry.')
      return false
    }
  }, [walletAddress, engineConfig])

  const refreshSession = useCallback(async () => {
    if (!walletAddress) {
      setSession(DEFAULT_SESSION)
      setSessionError(null)
      setSettlementState('UNAVAILABLE')
      settlementInFlightRef.current = false
      return
    }
    setIsRotating(true)
    setSessionError(null)
    const ensSubname = deriveSubname(walletAddress)
    let depositAddress: string | null = loadStoredDeposit(walletAddress)
    let derivedAddress: string | null = null
    let activeFlag: string | null = null
    let settlementText: string | null = null

    const ensClient = await getEnsClient()
    if (ensClient) {
      try {
        const [active, resolved, settlement] = await Promise.all([
          ensClient.getEnsText({ name: normalize(ensSubname), key: 'plop.active' }),
          ensClient.getEnsAddress({ name: normalize(ensSubname) }),
          ensClient.getEnsText({ name: normalize(ensSubname), key: 'plop.settlement' }),
        ])
        activeFlag = active ?? null
        derivedAddress = resolved ?? null
        settlementText = settlement ?? null
      } catch (err) {
        console.warn('[Session] ENS lookup failed', err)
      }
    }

    const isActive = activeFlag === 'true'
    if (!depositAddress) {
      try {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), 10000)
        const res = await fetch(`${getEngineUrl()}/session`, {
          method: 'POST',
          headers: getEngineHeaders(),
          body: JSON.stringify({ walletAddress, pairs: getDefaultPairs() }),
          signal: controller.signal,
        })
        window.clearTimeout(timeoutId)
        if (res.ok) {
          const payload = await res.json()
          depositAddress = typeof payload?.depositAddress === 'string' ? payload.depositAddress : depositAddress
          if (depositAddress) {
            storeDeposit(walletAddress, depositAddress)
          }
          if (!derivedAddress && ensClient) {
            try {
              derivedAddress = await ensClient.getEnsAddress({ name: normalize(ensSubname) })
            } catch {
              // ignore resolution failures
            }
          }
        } else {
          setSessionError(`[Session] Engine responded with ${res.status}`)
        }
      } catch (err) {
        console.warn('[Session] Engine session create failed', err)
        setSessionError('[Session] Engine request failed. Check ENGINE_URL / BitGo wallet config.')
      }
    }

    if (engineConfig?.settlementController) {
      if (settlementText) {
        setSettlementState('AUTHORIZED')
      } else if (!settlementInFlightRef.current) {
        setSettlementState('REQUIRES_SIGNATURE')
      }
    } else {
      setSettlementState('UNAVAILABLE')
    }

    if (
      walletAddress
      && !settlementText
      && engineConfig?.enginePublicKey
      && engineConfig?.settlementController
      && !settlementAttemptedRef.current
    ) {
      settlementAttemptedRef.current = true
      settlementInFlightRef.current = true
      const ok = await authorizeSettlement(ensSubname)
      settlementInFlightRef.current = false
      if (!ok) settlementAttemptedRef.current = false
    }

    const status = activeFlag === 'false'
      ? 'INACTIVE'
      : depositAddress
        ? 'ACTIVE'
        : 'INACTIVE'

    setSession({
      ensSubname,
      derivedAddress: derivedAddress || '—',
      status,
      sessionNonce: 0,
      depositAddress: depositAddress ?? null,
    })
    setIsRotating(false)
  }, [walletAddress, engineConfig, authorizeSettlement])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  const rotateAddress = useCallback(() => {
    void refreshSession()
  }, [refreshSession])

  const retrySettlement = useCallback(() => {
    if (!walletAddress) return
    settlementAttemptedRef.current = false
    settlementInFlightRef.current = true
    void authorizeSettlement(deriveSubname(walletAddress))
      .finally(() => {
        settlementInFlightRef.current = false
      })
  }, [walletAddress, authorizeSettlement])

  return {
    session,
    collateral,
    stats,
    rotateAddress,
    isRotating,
    sessionError,
    settlementState,
    retrySettlement,
    engineConfig,
    engineConfigStatus,
    reloadEngineConfig: loadEngineConfig,
  }
}

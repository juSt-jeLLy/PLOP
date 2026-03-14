import React from 'react'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import AddressDisplay from '@/components/ui/AddressDisplay'
import StatusBadge from '@/components/ui/StatusBadge'
import GradientButton from '@/components/ui/GradientButton'
import { SessionIdentity, SettlementState } from '@/types'

interface SessionIdentityCardProps {
  session: SessionIdentity
  onRotate: () => void
  isRotating: boolean
  walletConnected: boolean
  onConnect: () => void
  walletAddress?: string | null
  settlementState: SettlementState
  onAuthorizeSettlement: () => void
  configStatus: 'loading' | 'ready' | 'error'
  onReloadConfig: () => void
  error?: string | null
}

const SessionIdentityCard: React.FC<SessionIdentityCardProps> = ({
  session,
  onRotate,
  isRotating,
  walletConnected,
  onConnect,
  walletAddress,
  settlementState,
  onAuthorizeSettlement,
  configStatus,
  onReloadConfig,
  error,
}) => {
  const hasDeposit = Boolean(session.depositAddress)

  const settlementConfig: Record<SettlementState, { label: string; className: string }> = {
    AUTHORIZED: { label: 'Authorized', className: 'border-accent-green/40 text-accent-green' },
    REQUIRES_SIGNATURE: { label: 'Needs Signature', className: 'border-accent-yellow/40 text-accent-yellow' },
    SIGNING: { label: 'Signing…', className: 'border-accent-cyan/40 text-accent-cyan' },
    ERROR: { label: 'Failed', className: 'border-accent-red/40 text-accent-red' },
    UNAVAILABLE: { label: 'Unavailable', className: 'border-muted-foreground/40 text-muted-foreground' },
  }
  let settlementBadge = settlementConfig[settlementState]
  if (settlementState === 'UNAVAILABLE') {
    if (configStatus === 'loading') {
      settlementBadge = { label: 'Checking…', className: 'border-muted-foreground/40 text-muted-foreground' }
    } else if (configStatus === 'error') {
      settlementBadge = { label: 'Engine Offline', className: 'border-accent-red/40 text-accent-red' }
    }
  }
  const showAuthorize =
    settlementState === 'REQUIRES_SIGNATURE'
    || settlementState === 'ERROR'
    || settlementState === 'AUTHORIZED'
    || settlementState === 'SIGNING'

  if (!walletConnected) {
    return (
      <GlassCard>
        <div className="flex flex-col gap-3">
          <MonoLabel>Session Identity</MonoLabel>
          <div className="font-mono text-lg text-muted-foreground">
            Connect wallet to start a session
          </div>
          <GradientButton variant="secondary" size="sm" onClick={onConnect}>
            Connect Wallet
          </GradientButton>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        <MonoLabel>Session Identity</MonoLabel>
        <div className="font-mono text-lg gradient-text font-semibold">
          {session.ensSubname}
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <MonoLabel>Settlement Recipient (Hoodi)</MonoLabel>
            {walletAddress ? (
              <AddressDisplay address={walletAddress} truncate />
            ) : (
              <span className="text-xs text-muted-foreground font-mono">Connect wallet</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <MonoLabel>Settlement Authorization</MonoLabel>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-mono tracking-wider ${settlementBadge.className}`}
            >
              {settlementBadge.label}
            </span>
          </div>
          {settlementState === 'UNAVAILABLE' && configStatus === 'error' && (
            <GradientButton
              variant="secondary"
              size="sm"
              onClick={onReloadConfig}
            >
              Retry Engine Config
            </GradientButton>
          )}
          {showAuthorize && (
            <GradientButton
              variant="secondary"
              size="sm"
              onClick={onAuthorizeSettlement}
              loading={settlementState === 'SIGNING'}
            >
              {settlementState === 'AUTHORIZED'
                ? 'Reauthorize Settlement'
                : settlementState === 'ERROR'
                  ? 'Retry Authorization'
                  : 'Authorize Settlement'}
            </GradientButton>
          )}
        </div>
        <div className="flex items-center justify-between">
          <StatusBadge status={session.status} />
          <GradientButton variant="secondary" size="sm" onClick={onRotate} loading={isRotating}>
            Refresh
          </GradientButton>
        </div>
        {error && (
          <div className="text-xs text-accent-red font-mono">
            {error}
          </div>
        )}
        <div className="pt-2 border-t border-border/60">
          <MonoLabel>Deposit (Hoodi / BitGo)</MonoLabel>
          {hasDeposit ? (
            <AddressDisplay address={session.depositAddress || ''} truncate />
          ) : (
            <span className="text-xs text-muted-foreground font-mono">Pending</span>
          )}
        </div>
      </div>
    </GlassCard>
  )
}

export default SessionIdentityCard

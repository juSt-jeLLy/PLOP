import React from 'react'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import AddressDisplay from '@/components/ui/AddressDisplay'
import AddressRotationAnimation from '@/components/ui/AddressRotationAnimation'
import StatusBadge from '@/components/ui/StatusBadge'
import GradientButton from '@/components/ui/GradientButton'
import { SessionIdentity } from '@/types'

interface SessionIdentityCardProps {
  session: SessionIdentity
  onRotate: () => void
  isRotating: boolean
}

const SessionIdentityCard: React.FC<SessionIdentityCardProps> = ({ session, onRotate, isRotating }) => {
  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        <MonoLabel>Session Identity</MonoLabel>
        <div className="font-mono text-lg gradient-text font-semibold">
          {session.ensSubname}
        </div>
        <div>
          {isRotating ? (
            <AddressRotationAnimation
              fromAddress={session.derivedAddress}
              toAddress={'0x' + Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}
              onComplete={() => {}}
            />
          ) : (
            <AddressDisplay address={session.derivedAddress} truncate />
          )}
        </div>
        <div className="flex items-center justify-between">
          <StatusBadge status={session.status} />
          <GradientButton variant="secondary" size="sm" onClick={onRotate} loading={isRotating}>
            Rotate Now
          </GradientButton>
        </div>
      </div>
    </GlassCard>
  )
}

export default SessionIdentityCard

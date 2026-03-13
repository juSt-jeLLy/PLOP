import React from 'react'
import { WalletState } from '@/types'
import GradientButton from '@/components/ui/GradientButton'
import AddressDisplay from '@/components/ui/AddressDisplay'
import PulsingDot from '@/components/ui/PulsingDot'
import { useNavigate, useLocation } from 'react-router-dom'

interface NavbarProps {
  walletState: WalletState
  onConnect: () => void
  onDisconnect: () => void
}

const Navbar: React.FC<NavbarProps> = ({ walletState, onConnect, onDisconnect }) => {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <nav className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border">
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
        {/* Rotating hexagon */}
        <svg
          width="28" height="28" viewBox="0 0 28 28"
          className="animate-[spin_8s_linear_infinite]"
        >
          <polygon
            points="14,1 25,7.5 25,20.5 14,27 3,20.5 3,7.5"
            fill="none"
            stroke="url(#hexGrad)"
            strokeWidth="1.5"
          />
          <defs>
            <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--accent-purple))" />
              <stop offset="100%" stopColor="hsl(var(--accent-cyan))" />
            </linearGradient>
          </defs>
        </svg>
        <span className="font-syne text-xl font-bold tracking-[0.1em] gradient-text">PLOP</span>
      </div>

      <div className="flex items-center gap-4">
        {location.pathname !== '/dashboard' && (
          <button
            onClick={() => navigate('/dashboard')}
            className="text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            Dashboard
          </button>
        )}
        {location.pathname !== '/' && (
          <button
            onClick={() => navigate('/')}
            className="text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            Home
          </button>
        )}

        {!walletState.connected ? (
          <GradientButton variant="secondary" onClick={onConnect} size="sm">
            Connect Wallet
          </GradientButton>
        ) : (
          <button
            onClick={onDisconnect}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-secondary/50 hover:bg-secondary transition-colors"
          >
            <PulsingDot color="green" />
            <AddressDisplay address={walletState.address || ''} truncate />
          </button>
        )}
      </div>
    </nav>
  )
}

export default Navbar

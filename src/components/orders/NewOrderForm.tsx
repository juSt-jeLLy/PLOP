import React, { useState } from 'react'
import GlassCard from '@/components/ui/GlassCard'
import GradientButton from '@/components/ui/GradientButton'
import TokenPairSelect from '@/components/ui/TokenPairSelect'
import MonoLabel from '@/components/ui/MonoLabel'
import { TokenPair, OrderType } from '@/types'
import { getDefaultPairs, getDemoPrice, parseTokenPair } from '@/lib/tokens'

interface NewOrderFormProps {
  onSubmit: (data: { type: OrderType; pair: TokenPair; amount: number; price: number; ttlSeconds: number }) => void
  isSubmitting: boolean
  walletConnected?: boolean
  onConnect?: () => void
}

const ttlOptions = [
  { label: '5min', value: 300 },
  { label: '15min', value: 900 },
  { label: '1hour', value: 3600 },
]

const defaultPairs = getDefaultPairs()

const NewOrderForm: React.FC<NewOrderFormProps> = ({ onSubmit, isSubmitting, walletConnected = true, onConnect }) => {
  const [orderType, setOrderType] = useState<OrderType>('BUY')
  const [pair, setPair] = useState<TokenPair>((defaultPairs[0] || 'ETH/ETH') as TokenPair)
  const [amount, setAmount] = useState('')
  const [ttl, setTtl] = useState(300)
  const [showSuccess, setShowSuccess] = useState(false)
  const demoPrice = getDemoPrice(pair)
  const { base, quote } = parseTokenPair(pair)
  const canSubmit = Boolean(amount) && Number.isFinite(demoPrice) && demoPrice! > 0

  const handleSubmit = () => {
    if (!amount || !canSubmit) return
    onSubmit({ type: orderType, pair, amount: parseFloat(amount), price: demoPrice as number, ttlSeconds: ttl })
    setTimeout(() => {
      setShowSuccess(true)
      setTimeout(() => {
        setShowSuccess(false)
        setAmount('')
      }, 1200)
    }, 1300)
  }

  return (
    <GlassCard>
      <div className="flex flex-col gap-4">
        {/* Buy/Sell toggle */}
        <div className="flex gap-1 p-1 rounded-lg bg-secondary/50">
          <button
            onClick={() => setOrderType('BUY')}
            disabled={!walletConnected}
            className={`flex-1 py-2 rounded-md text-sm font-mono transition-all ${
              orderType === 'BUY' ? 'bg-accent-green/20 text-accent-green border border-accent-green/30' : 'text-muted-foreground'
            } ${!walletConnected ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            BUY
          </button>
          <button
            onClick={() => setOrderType('SELL')}
            disabled={!walletConnected}
            className={`flex-1 py-2 rounded-md text-sm font-mono transition-all ${
              orderType === 'SELL' ? 'bg-accent-red/20 text-accent-red border border-accent-red/30' : 'text-muted-foreground'
            } ${!walletConnected ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            SELL
          </button>
        </div>

        <div>
          <MonoLabel>Token Pair</MonoLabel>
          <div className="mt-1.5">
            <TokenPairSelect value={pair} onChange={setPair} disabled={!walletConnected} />
          </div>
        </div>

        <div>
          <MonoLabel>Amount</MonoLabel>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={!walletConnected}
            className={`mt-1.5 w-full bg-secondary border border-border rounded-lg px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 ${!walletConnected ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>

        <div>
          <MonoLabel>TTL</MonoLabel>
          <div className="flex gap-2 mt-1.5">
            {ttlOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTtl(opt.value)}
                disabled={!walletConnected}
                className={`flex-1 py-1.5 rounded-md text-xs font-mono transition-all ${
                  ttl === opt.value ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-secondary text-muted-foreground border border-border'
                } ${!walletConnected ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-accent-cyan">
          <span>🔒</span>
          <span>Order will be encrypted with NaCl box before submission</span>
        </div>

        <GradientButton
          variant={walletConnected ? 'primary' : 'secondary'}
          fullWidth
          onClick={walletConnected ? handleSubmit : onConnect}
          loading={isSubmitting}
          disabled={!walletConnected || !canSubmit}
        >
          {walletConnected ? (showSuccess ? '✓ Order Live' : '→ Encrypt & Submit Order') : 'Connect Wallet'}
        </GradientButton>
      </div>
    </GlassCard>
  )
}

export default NewOrderForm

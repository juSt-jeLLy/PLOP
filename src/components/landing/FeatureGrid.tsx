import React from 'react'
import GlassCard from '@/components/ui/GlassCard'

const features = [
  { icon: '🔄', title: 'ENS Auto-Rotation', desc: 'Fresh address on every session. Your on-chain history stays yours.' },
  { icon: '🔐', title: 'Encrypted Order Book', desc: 'Orders exist as encrypted files. Counterparty revealed only on match.' },
  { icon: '🏦', title: 'BitGo Settlement', desc: 'Atomic MPC settlement. Policy-enforced. No partial fills.' },
]

const FeatureGrid: React.FC = () => {
  return (
    <section className="relative z-10 max-w-5xl mx-auto px-6 py-20">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {features.map((f, i) => (
          <div key={f.title} className="animate-fade-up" style={{ animationDelay: `${500 + i * 100}ms` }}>
            <GlassCard hoverable>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-2xl mb-4">
                {f.icon}
              </div>
              <h3 className="font-syne text-lg font-semibold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </GlassCard>
          </div>
        ))}
      </div>
    </section>
  )
}

export default FeatureGrid

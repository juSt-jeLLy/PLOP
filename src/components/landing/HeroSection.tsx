import React from 'react'
import GradientButton from '@/components/ui/GradientButton'

interface HeroSectionProps {
  onEnterPool: () => void
}

const HeroSection: React.FC<HeroSectionProps> = ({ onEnterPool }) => {
  return (
    <section className="relative z-10 flex flex-col items-center justify-center min-h-[80vh] px-6 text-center">
      <div className="animate-fade-up" style={{ animationDelay: '0ms' }}>
        <span className="inline-block font-mono text-xs tracking-[0.2em] text-accent-cyan mb-6 px-4 py-1.5 rounded-full border border-accent/20">
          [ PRIVACY-PRESERVING OTC ]
        </span>
      </div>

      <h1 className="animate-fade-up font-syne text-5xl md:text-7xl lg:text-8xl font-bold leading-tight mb-6" style={{ animationDelay: '100ms' }}>
        <span className="block text-foreground">Trade Without</span>
        <span className="block gradient-text">Telegraphing</span>
      </h1>

      <p className="animate-fade-up text-lg text-muted-foreground max-w-xl mb-10" style={{ animationDelay: '200ms' }}>
        Privacy-preserving OTC for institutions. Encrypted order book, ENS auto-rotation, atomic MPC settlement.
      </p>

      <div className="animate-fade-up" style={{ animationDelay: '300ms' }}>
        <GradientButton variant="primary" onClick={onEnterPool}>
          → Enter PLOP
        </GradientButton>
      </div>
    </section>
  )
}

export default HeroSection

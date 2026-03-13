import React from 'react'

const GradientBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-background" />
      <div
        className="absolute w-[600px] h-[600px] -top-40 -left-40 rounded-full opacity-60"
        style={{
          background: 'radial-gradient(ellipse, hsl(var(--accent-purple) / 0.15), transparent)',
          animation: 'drift1 30s infinite alternate',
        }}
      />
      <div
        className="absolute w-[500px] h-[500px] -top-20 -right-40 rounded-full opacity-60"
        style={{
          background: 'radial-gradient(ellipse, hsl(var(--accent-cyan) / 0.1), transparent)',
          animation: 'drift2 25s infinite alternate',
        }}
      />
      <div
        className="absolute w-[700px] h-[700px] -bottom-40 left-1/2 -translate-x-1/2 rounded-full opacity-60"
        style={{
          background: 'radial-gradient(ellipse, hsl(var(--accent-green) / 0.08), transparent)',
          animation: 'drift3 35s infinite alternate',
        }}
      />
      {/* Noise overlay */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />
    </div>
  )
}

export default GradientBackground

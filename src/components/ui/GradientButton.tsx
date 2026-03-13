import React from 'react'
import { Loader2 } from 'lucide-react'

interface GradientButtonProps {
  children: React.ReactNode
  variant: 'primary' | 'secondary' | 'danger'
  onClick?: () => void
  disabled?: boolean
  fullWidth?: boolean
  loading?: boolean
  size?: 'sm' | 'md'
}

const GradientButton: React.FC<GradientButtonProps> = ({
  children,
  variant,
  onClick,
  disabled = false,
  fullWidth = false,
  loading = false,
  size = 'md',
}) => {
  const base = `
    relative overflow-hidden font-mono tracking-wider rounded-lg
    transition-all duration-200 inline-flex items-center justify-center gap-2
    ${size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-6 py-3 text-sm'}
    ${fullWidth ? 'w-full' : ''}
    ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
  `

  const variants: Record<string, string> = {
    primary: `
      bg-gradient-to-r from-primary to-accent text-primary-foreground
      ${!disabled ? 'hover:shadow-[0_0_40px_hsl(var(--accent-purple)/0.4)]' : ''}
    `,
    secondary: `
      bg-transparent border border-primary/40 text-primary
      ${!disabled ? 'hover:shadow-[0_0_20px_hsl(var(--accent-purple)/0.2)] hover:border-primary/60' : ''}
    `,
    danger: `
      bg-transparent border border-destructive/60 text-destructive
      ${!disabled ? 'hover:shadow-[0_0_20px_hsl(var(--accent-red)/0.3)]' : ''}
    `,
  }

  return (
    <button
      onClick={disabled || loading ? undefined : onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]}`}
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>...</span>
        </>
      ) : (
        children
      )}
      {variant === 'primary' && !disabled && (
        <span className="absolute inset-0 pointer-events-none overflow-hidden">
          <span className="absolute inset-0 opacity-0 hover:opacity-100 bg-gradient-to-r from-transparent via-foreground/10 to-transparent animate-[shimmer_2s_infinite]" />
        </span>
      )}
    </button>
  )
}

export default GradientButton

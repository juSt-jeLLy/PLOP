import React, { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface AddressDisplayProps {
  address: string
  truncate?: boolean
}

const AddressDisplay: React.FC<AddressDisplayProps> = ({ address, truncate = false }) => {
  const [copied, setCopied] = useState(false)
  const displayed = truncate ? address.slice(0, 6) + '...' + address.slice(-4) : address

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <span className="inline-flex items-center gap-1.5 group font-mono text-sm text-muted-foreground">
      <span>{displayed}</span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {copied && (
        <span className="text-[10px] text-accent-green font-mono">Copied!</span>
      )}
    </span>
  )
}

export default AddressDisplay

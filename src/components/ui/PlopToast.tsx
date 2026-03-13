import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle, XCircle, Info, RefreshCw } from 'lucide-react'
import { ToastMessage } from '@/types'

interface ToastProps {
  toast: ToastMessage
  onDismiss: (id: string) => void
}

const iconMap = {
  success: <CheckCircle className="w-4 h-4 text-accent-green" />,
  error: <XCircle className="w-4 h-4 text-accent-red" />,
  info: <Info className="w-4 h-4 text-accent-cyan" />,
  rotation: <RefreshCw className="w-4 h-4 text-accent-purple" />,
}

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    setProgress(0)
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <motion.div
      initial={{ x: 100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 100, opacity: 0 }}
      className="w-[300px] bg-card/90 backdrop-blur-xl border border-border rounded-xl p-4 overflow-hidden"
    >
      <div className="flex items-center gap-3">
        {iconMap[toast.type]}
        <span className="text-sm text-foreground">{toast.message}</span>
      </div>
      <div className="mt-3 h-0.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all ease-linear"
          style={{
            width: `${progress}%`,
            transitionDuration: '4000ms',
          }}
        />
      </div>
    </motion.div>
  )
}

export default Toast

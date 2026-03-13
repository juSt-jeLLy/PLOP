import React, { useState, useEffect, useRef } from 'react'

interface AddressRotationAnimationProps {
  fromAddress: string
  toAddress: string
  onComplete: () => void
}

const hexChars = '0123456789abcdef'

const AddressRotationAnimation: React.FC<AddressRotationAnimationProps> = ({ fromAddress, toAddress, onComplete }) => {
  const [display, setDisplay] = useState(fromAddress)
  const [glowing, setGlowing] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()
  const completedRef = useRef(false)

  useEffect(() => {
    const chars = toAddress.split('')
    let lockedCount = 0

    // Phase 1: scramble all
    intervalRef.current = setInterval(() => {
      setDisplay(
        chars.map((c, i) => {
          if (i < lockedCount) return chars[i]
          return hexChars[Math.floor(Math.random() * 16)]
        }).join('')
      )
    }, 50)

    // Phase 2: start locking after 300ms
    const lockDelay = 300
    const lockInterval = 800 / chars.length

    const lockTimer = setTimeout(() => {
      const lockInt = setInterval(() => {
        lockedCount++
        if (lockedCount >= chars.length) {
          clearInterval(lockInt)
          clearInterval(intervalRef.current)
          setDisplay(toAddress)
          setGlowing(true)

          // Phase 3: green glow then complete
          setTimeout(() => {
            setGlowing(false)
            if (!completedRef.current) {
              completedRef.current = true
              onComplete()
            }
          }, 400)
        }
      }, lockInterval)
    }, lockDelay)

    return () => {
      clearInterval(intervalRef.current)
      clearTimeout(lockTimer)
    }
  }, [toAddress, onComplete, fromAddress])

  return (
    <span
      className={`font-mono text-sm transition-all duration-200 ${glowing ? 'text-accent-green shadow-[0_0_20px_hsl(var(--accent-green)/0.5)]' : 'text-accent-cyan'}`}
    >
      {display}
    </span>
  )
}

export default AddressRotationAnimation

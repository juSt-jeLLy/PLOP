import React from 'react'
import { motion } from 'framer-motion'
import { ActivityEvent } from '@/types'

interface ActivityFeedItemProps {
  event: ActivityEvent
}

const typeColors: Record<ActivityEvent['type'], string> = {
  NEW_ORDER: 'text-accent-cyan',
  MATCH_FOUND: 'text-accent-green',
  ADDRESS_ROTATED: 'text-accent-purple',
  SETTLEMENT: 'text-accent-green',
}

const ActivityFeedItem: React.FC<ActivityFeedItemProps> = ({ event }) => {
  const time = event.timestamp.toLocaleTimeString('en-US', { hour12: false })

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-2 py-1.5 text-xs"
    >
      <span className="text-muted-foreground font-mono shrink-0">[{time}]</span>
      <span className={`font-mono ${typeColors[event.type]}`}>{event.description}</span>
    </motion.div>
  )
}

export default ActivityFeedItem

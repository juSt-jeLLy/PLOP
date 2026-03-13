import React from 'react'
import { AnimatePresence } from 'framer-motion'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import ActivityFeedItem from './ActivityFeedItem'
import { ActivityEvent } from '@/types'

interface ActivityFeedProps {
  events: ActivityEvent[]
}

const ActivityFeed: React.FC<ActivityFeedProps> = ({ events }) => {
  return (
    <GlassCard>
      <MonoLabel>Pool Activity</MonoLabel>
      <div className="mt-3 max-h-[300px] overflow-y-auto flex flex-col gap-1">
        <AnimatePresence initial={false}>
          {events.map(event => (
            <ActivityFeedItem key={event.id} event={event} />
          ))}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}

export default ActivityFeed

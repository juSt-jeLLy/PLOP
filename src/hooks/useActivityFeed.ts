import { useState, useEffect, useRef } from 'react'
import { ActivityEvent } from '@/types'
import { mockActivityFeed } from '@/mock/mockActivity'

export function useActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>(mockActivityFeed)
  const indexRef = useRef(0)

  useEffect(() => {
    const interval = setInterval(() => {
      const template = mockActivityFeed[indexRef.current % mockActivityFeed.length]
      const newEvent: ActivityEvent = {
        ...template,
        id: Date.now().toString(),
        timestamp: new Date(),
      }
      setEvents(prev => [newEvent, ...prev].slice(0, 20))
      indexRef.current++
    }, 8000)

    return () => clearInterval(interval)
  }, [])

  return { events }
}

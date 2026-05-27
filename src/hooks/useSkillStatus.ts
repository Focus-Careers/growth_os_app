import { useState, useEffect, useCallback } from 'react'
import supabase from '../services/supabase'

export interface SkillStatus {
  employee: string
  skill: string
  status: 'running' | 'complete'
  message: string | null
  sidebar_message: string | null
}

interface UseSkillStatusParams {
  userDetailsId: string | null
}

/**
 * Listens for skill_status broadcast events.
 * Running statuses are tracked for display at the bottom of chat.
 * Status messages are persisted to DB server-side, so no client-side injection needed.
 */
export default function useSkillStatus({ userDetailsId }: UseSkillStatusParams) {
  const [activeSkills, setActiveSkills] = useState<SkillStatus[]>([])

  // Clear all running-skill indicators immediately (used on user-initiated stop,
  // where the cancelled run won't emit a matching 'complete' event).
  const clearActiveSkills = useCallback(() => setActiveSkills([]), [])

  useEffect(() => {
    if (!userDetailsId) return

    const channel = supabase
      .channel(`skill_status:${userDetailsId}`)
      .on('broadcast', { event: 'skill_status' }, ({ payload }) => {
        const status = payload as SkillStatus
        if (status.status === 'running') {
          setActiveSkills(prev => {
            const existing = prev.findIndex(s => s.employee === status.employee && s.skill === status.skill)
            if (existing !== -1) {
              const updated = [...prev]
              updated[existing] = status
              return updated
            }
            return [...prev, status]
          })
        } else if (status.status === 'complete') {
          setActiveSkills(prev =>
            prev.filter(s => !(s.employee === status.employee && s.skill === status.skill))
          )
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userDetailsId])

  return { activeSkills, clearActiveSkills }
}

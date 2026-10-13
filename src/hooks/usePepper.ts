import { useState, useEffect, useCallback } from 'react'
import supabase from '../services/supabase'
import { authFetch } from '../services/api'
import { SENDER_COLUMNS } from '../types/index'
import type { Employee, Account, Sender, SenderUpdate, ActivityMessage } from '../types/index'

const API_URL = import.meta.env.VITE_API_URL

interface UsePepperParams {
  accountId: string | null
  userDetailsId: string | null
  selectedEmployee: Employee
  firstname?: string
}

export interface PepperUserDetails {
  firstname: string
  email: string
  signup_complete: boolean
  active_skill: any | null
  queued_mobilisations: any[]
}

export default function usePepper({ accountId, userDetailsId, selectedEmployee, firstname }: UsePepperParams) {
  const [account, setAccount] = useState<Account | null>(null)
  const [userDetails, setUserDetails] = useState<PepperUserDetails | null>(null)
  const [activityLog, setActivityLog] = useState<ActivityMessage[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [pepperSummary, setPepperSummary] = useState<string | null>(null)
  const [pepperSummaryLoading, setPepperSummaryLoading] = useState(false)

  const fetchSenders = useCallback(async () => {
    if (!accountId) return
    const { data } = await supabase.from('senders').select(SENDER_COLUMNS).eq('account_id', accountId)
    setSenders((data ?? []) as Sender[])
  }, [accountId])

  useEffect(() => {
    if (selectedEmployee.name !== 'Pepper' || !accountId) return

    supabase.from('account').select('*').eq('id', accountId).single()
      .then(({ data }) => setAccount(data as Account | null))

    fetchSenders()

    if (!pepperSummary && !pepperSummaryLoading) {
      setPepperSummaryLoading(true)
      fetch(`${API_URL}/api/messages/pepper-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, firstname, user_details_id: userDetailsId }),
      })
        .then(r => r.json())
        .then(data => setPepperSummary(data.message ?? null))
        .catch(() => {})
        .finally(() => setPepperSummaryLoading(false))
    }
  }, [selectedEmployee, accountId, fetchSenders])

  useEffect(() => {
    if (selectedEmployee.name !== 'Pepper' || !userDetailsId) return

    supabase.from('user_details')
      .select('firstname, email, signup_complete, active_skill, queued_mobilisations')
      .eq('id', userDetailsId).single()
      .then(({ data }) => setUserDetails(data as PepperUserDetails | null))

    supabase.from('messages')
      .select('id, message_body, is_agent, is_status, created_at')
      .eq('user_details_id', userDetailsId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setActivityLog((data ?? []) as ActivityMessage[]))
  }, [selectedEmployee, userDetailsId])

  const updateUserFirstname = useCallback(async (firstname: string) => {
    if (!userDetailsId) return
    const { error } = await supabase.from('user_details').update({ firstname }).eq('id', userDetailsId)
    if (!error) {
      setUserDetails(prev => prev ? { ...prev, firstname } : prev)
    }
    return error
  }, [userDetailsId])

  const updateSender = useCallback(async (senderId: string, updates: SenderUpdate) => {
    const res = await authFetch(`/api/senders/${senderId}/credentials`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return new Error(data.error ?? 'Failed to update sender')
    setSenders(prev => prev.map(s => s.id === senderId ? { ...s, ...data.sender } : s))
    return null
  }, [])

  return { account, userDetails, activityLog, senders, pepperSummary, updateUserFirstname, updateSender, refreshSenders: fetchSenders }
}

import { useState, useRef, useCallback } from 'react'
import supabase from '../services/supabase'
import type { User } from '@supabase/supabase-js'
import type { Message } from '../types/index'

const API_URL = import.meta.env.VITE_API_URL

export interface CompanyRecord {
  id: string
  account_id: string | null
  account_name: string | null
  website: string | null
  signup_complete: boolean
  firstname: string | null
  active_mobilisation: string | null
  active_step_id: string | null
  role: string | null
  is_super_admin: boolean
}

interface UserDetailsData {
  id: string
  account_id: string | null
  signup_complete: boolean
  firstname: string | null
  active_mobilisation: string | null
  active_step_id: string | null
}

interface UseUserDetailsParams {
  user: User | null | undefined
}

/**
 * Manages user details state, message loading, and real-time subscriptions.
 *
 * Does NOT run initialise automatically — the orchestrator (App.tsx) is responsible
 * for calling initialise() and wiring up mobilisation callbacks once both hooks are ready.
 */
export default function useUserDetails({ user }: UseUserDetailsParams) {
  const [userDetailsId, setUserDetailsId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [userFirstName, setUserFirstName] = useState('')
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const userFirstNameRef = useRef('')
  const userDetailsIdRef = useRef<string | null>(null)
  const companiesRef = useRef<CompanyRecord[]>([])
  const initialiseRan = useRef(false)

  /**
   * Fetch all user_details rows for the auth user.
   * Sets companies state and activates the first (or previously saved) company.
   * Returns the active UserDetailsData so App.tsx can decide what to do next.
   */
  const initialise = useCallback(async (): Promise<UserDetailsData | null> => {
    if (!user) return null

    const res = await fetch(`${API_URL}/api/user/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_id: user.id }),
    })
    if (!res.ok) return null
    const { companies: rows } = await res.json()
    if (!rows || rows.length === 0) return null

    const mapped: CompanyRecord[] = rows.map((r: any) => ({
      id: r.id,
      account_id: r.account_id,
      account_name: r.account_name ?? null,
      website: r.website ?? null,
      signup_complete: r.signup_complete,
      firstname: r.firstname,
      active_mobilisation: r.active_mobilisation,
      active_step_id: r.active_step_id,
      role: r.role ?? null,
      is_super_admin: r.is_super_admin ?? false,
    }))
    companiesRef.current = mapped
    setCompanies(mapped)

    // Restore last active company from localStorage if valid
    const savedId = localStorage.getItem('active_company_id')
    const active = (savedId && mapped.find(c => c.id === savedId)) || mapped[0]

    userDetailsIdRef.current = active.id
    setUserDetailsId(active.id)
    setAccountId(active.account_id)
    userFirstNameRef.current = active.firstname ?? ''
    setUserFirstName(active.firstname ?? '')

    return {
      id: active.id,
      account_id: active.account_id,
      signup_complete: active.signup_complete,
      firstname: active.firstname,
      active_mobilisation: active.active_mobilisation,
      active_step_id: active.active_step_id,
    }
  }, [user])

  /**
   * Switch the active company workspace.
   * Fetches fresh user_details from DB so signup_complete and active_mobilisation
   * are never stale (they change mid-session as the user progresses).
   */
  const switchCompany = useCallback(async (targetId: string): Promise<UserDetailsData | null> => {
    const { data, error } = await supabase
      .from('user_details')
      .select('id, account_id, signup_complete, firstname, active_mobilisation, active_step_id, role, is_super_admin')
      .eq('id', targetId)
      .single()

    if (error || !data) return null

    // Keep companies list in sync with fresh data
    setCompanies(prev => {
      const next = prev.map(c => c.id === targetId ? {
        ...c,
        signup_complete: data.signup_complete,
        firstname: data.firstname,
        active_mobilisation: data.active_mobilisation,
        active_step_id: data.active_step_id,
        role: (data as any).role ?? null,
        is_super_admin: (data as any).is_super_admin ?? false,
      } : c)
      companiesRef.current = next
      return next
    })

    localStorage.setItem('active_company_id', targetId)
    userDetailsIdRef.current = targetId
    setUserDetailsId(targetId)
    setAccountId(data.account_id)
    userFirstNameRef.current = data.firstname ?? ''
    setUserFirstName(data.firstname ?? '')

    return data as UserDetailsData
  }, [])

  /**
   * Add a newly created company to the local companies list and activate it.
   */
  const updateCompanyName = useCallback((accountId: string, name: string) => {
    setCompanies(prev => {
      const next = prev.map(c => c.account_id === accountId ? { ...c, account_name: name } : c)
      companiesRef.current = next
      return next
    })
  }, [])

  const addCompany = useCallback((company: CompanyRecord) => {
    setCompanies(prev => {
      const next = [...prev, company]
      companiesRef.current = next
      return next
    })
    localStorage.setItem('active_company_id', company.id)
    userDetailsIdRef.current = company.id
    setUserDetailsId(company.id)
    setAccountId(company.account_id)
    userFirstNameRef.current = company.firstname ?? ''
    setUserFirstName(company.firstname ?? '')
  }, [])

  /** Load all messages for a given user_details id. */
  const loadMessages = useCallback(async (detailsId: string): Promise<Message[]> => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('user_details_id', detailsId)
      .order('created_at', { ascending: true })

    if (!error && data) return data as Message[]
    return []
  }, [])

  /** Save a single message to the messages table. Triggers message processor for user messages unless triggerProcessor is false. */
  const saveMessage = useCallback(async (message_body: string, is_agent: boolean, triggerProcessor = true): Promise<Message | null> => {
    // Use ref so messages are always saved to the currently active company,
    // even when called immediately after a company switch before re-render.
    const currentId = userDetailsIdRef.current
    if (!currentId) return null
    const { data } = await supabase
      .from('messages')
      .insert({ message_body, is_agent, user_details_id: currentId })
      .select()
      .single()

    // Trigger message processor directly for user messages (replaces Supabase webhook)
    if (!is_agent && data && triggerProcessor) {
      fetch(`${API_URL}/api/messages/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record: { user_details_id: currentId, is_agent: false, message_body }, type: 'INSERT' }),
      }).catch(err => console.error('[saveMessage] processor trigger error:', err))
    }

    return data as Message | null
  }, [])

  /**
   * Subscribe to real-time broadcasts and postgres_changes for a user_details row.
   * The caller provides callbacks so the hook remains decoupled from message/mobilisation state.
   */
  const subscribeToMessages = useCallback((
    detailsId: string,
    callbacks: {
      setIsTyping: (v: boolean) => void
      setMessages: React.Dispatch<React.SetStateAction<Message[]>>
      startMobilisation: (name: string) => Promise<void>
      onCancelled: () => void
    },
  ) => {
    let typingTimeout: ReturnType<typeof setTimeout> | null = null

    const channel = supabase
      .channel(`user:${detailsId}`)
      .on('broadcast', { event: 'agent_typing' }, ({ payload }) => {
        callbacks.setIsTyping(payload.typing)
        // Fix #5: Auto-clear typing indicator after 30s in case server never sends false
        if (typingTimeout) clearTimeout(typingTimeout)
        if (payload.typing) {
          typingTimeout = setTimeout(() => callbacks.setIsTyping(false), 30000)
        }
      })
      .on('broadcast', { event: 'start_mobilisation' }, ({ payload }) => {
        callbacks.startMobilisation(payload.mobilisation)
      })
      .on('broadcast', { event: 'cancelled' }, () => {
        callbacks.onCancelled()
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `user_details_id=eq.${detailsId}`,
      }, (payload: any) => {
        callbacks.setIsTyping(false)
        callbacks.setMessages((prev: Message[]) => {
          if (prev.some(m => m.id === payload.new.id)) return prev
          const tempIndex = prev.findIndex(
            m => !m.id && m.message_body === payload.new.message_body && m.is_agent === payload.new.is_agent,
          )
          if (tempIndex !== -1) {
            const next = [...prev]
            next[tempIndex] = payload.new
            return next
          }
          return [...prev, payload.new]
        })
      })
      .subscribe()

    return () => {
      if (typingTimeout) clearTimeout(typingTimeout)
      supabase.removeChannel(channel)
    }
  }, [])

  const role = companies.find(c => c.id === userDetailsId)?.role ?? null
  const isSuperAdmin = companies.find(c => c.id === userDetailsId)?.is_super_admin ?? false

  return {
    userDetailsId,
    accountId,
    userFirstName,
    userFirstNameRef,
    userDetailsIdRef,
    companiesRef,
    initialiseRan,
    companies,
    role,
    isSuperAdmin,
    setCompanies,
    initialise,
    switchCompany,
    addCompany,
    updateCompanyName,
    loadMessages,
    saveMessage,
    subscribeToMessages,
  }
}

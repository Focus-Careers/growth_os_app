import { useState, useEffect, useCallback } from 'react'
import supabase from '../services/supabase'

export interface Campaign {
  id: string
  name: string
  status: string
  num_emails: number
  tone: string | null
  subject_line: string | null
  email_template: string | null
  email_sequence: { seq_number: number; delay_in_days: number; subject: string; body: string }[] | null
  itp_id: string | null
  sender_id: string | null
  created_at: string
  contact_count?: number
  stats?: { sent: number; opened: number; replied: number; bounced: number }
}

export interface CampaignSender {
  id: string
  email: string
  display_name: string | null
  verified: boolean
  verification_error: string | null
  smtp_host: string | null
}

export interface CampaignContact {
  id: string
  contact_id: string
  status: string
  sent_at: string | null
  opened_at: string | null
  replied_at: string | null
  email_body: string | null
  reply_body: string | null
  classification: 'positive' | 'negative' | 'neutral' | 'out_of_office' | null
  contact?: {
    first_name: string
    last_name: string
    email: string
    role: string | null
    target_id?: string
    targets?: {
      title: string | null
      domain: string | null
    }
  }
}

export interface CampaignItp {
  id: string
  name: string | null
  itp_summary: string | null
}

interface UseCampaignsParams {
  accountId: string | null
  userDetailsId: string | null
  selectedEmployee: { name: string }
  firstname?: string
}

const API_URL = import.meta.env.VITE_API_URL

export default function useCampaigns({ accountId, userDetailsId, selectedEmployee, firstname }: UseCampaignsParams) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [campaignContacts, setCampaignContacts] = useState<CampaignContact[]>([])
  const [campaignItp, setCampaignItp] = useState<CampaignItp | null>(null)
  const [draperSummary, setDraperSummary] = useState<string | null>(null)
  const [draperSummaryLoading, setDraperSummaryLoading] = useState(false)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [hasMoreContacts, setHasMoreContacts] = useState(false)
  const CONTACTS_PAGE_SIZE = 50
  const [campaignSenders, setCampaignSenders] = useState<Record<string, CampaignSender>>({})
  const [allSenders, setAllSenders] = useState<CampaignSender[]>([])

  const fetchCampaigns = useCallback(async () => {
    if (!accountId) return
    const { data } = await supabase
      .from('campaigns')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    const campaignList = (data ?? []) as Campaign[]

    // Fetch contact counts and status stats for each campaign
    const ids = campaignList.map(c => c.id)
    if (ids.length > 0) {
      const { data: ccData } = await supabase
        .from('campaign_contacts')
        .select('campaign_id, status')
        .in('campaign_id', ids)

      const counts: Record<string, number> = {}
      const statsBycamp: Record<string, { sent: number; opened: number; replied: number; bounced: number }> = {}

      for (const row of (ccData ?? []) as { campaign_id: string; status: string }[]) {
        counts[row.campaign_id] = (counts[row.campaign_id] ?? 0) + 1
        if (!statsBycamp[row.campaign_id]) statsBycamp[row.campaign_id] = { sent: 0, opened: 0, replied: 0, bounced: 0 }
        if (row.status === 'sent') statsBycamp[row.campaign_id].sent++
        else if (row.status === 'opened') statsBycamp[row.campaign_id].opened++
        else if (row.status === 'replied') statsBycamp[row.campaign_id].replied++
        else if (row.status === 'bounced' || row.status === 'failed') statsBycamp[row.campaign_id].bounced++
      }

      for (const c of campaignList) {
        c.contact_count = counts[c.id] ?? 0
        c.stats = statsBycamp[c.id] ?? { sent: 0, opened: 0, replied: 0, bounced: 0 }
      }
    }

    setCampaigns(campaignList)

    // Fetch senders for campaigns that have one
    const senderIds = [...new Set(campaignList.map(c => c.sender_id).filter(Boolean))] as string[]
    if (senderIds.length > 0) {
      const { data: senderData } = await supabase
        .from('senders')
        .select('id, email, display_name, verified, verification_error, smtp_host')
        .in('id', senderIds)
      const senderMap: Record<string, CampaignSender> = {}
      for (const s of (senderData ?? []) as CampaignSender[]) {
        senderMap[s.id] = s
      }
      setCampaignSenders(senderMap)
    }
  }, [accountId])

  // Fetch all senders for the account (for the change dropdown)
  useEffect(() => {
    if (selectedEmployee.name === 'Draper' && accountId) {
      supabase.from('senders').select('id, email, display_name, verified, verification_error, smtp_host').eq('account_id', accountId)
        .then(({ data }) => setAllSenders((data ?? []) as CampaignSender[]))
    }
  }, [selectedEmployee, accountId])

  // Load campaigns + summary when Draper is selected
  useEffect(() => {
    if (selectedEmployee.name === 'Draper' && accountId) {
      fetchCampaigns()
      // Fetch Draper summary (only if we don't have one cached)
      if (!draperSummary && !draperSummaryLoading) {
        setDraperSummaryLoading(true)
        fetch(`${API_URL}/api/messages/draper-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accountId, firstname }),
        })
          .then(r => r.json())
          .then(data => setDraperSummary(data.message ?? null))
          .catch(() => {})
          .finally(() => setDraperSummaryLoading(false))
      }
    }
  }, [selectedEmployee, accountId, fetchCampaigns, draperSummary, draperSummaryLoading])

  // Fetch contacts + ITP when a campaign is selected
  useEffect(() => {
    if (!selectedCampaign) {
      setCampaignContacts([])
      setCampaignItp(null)
      return
    }

    // Fetch all contacts for this campaign (no limit — pipeline needs all statuses)
    setContactsLoading(true)
    setHasMoreContacts(false)
    supabase
      .from('campaign_contacts')
      .select('*, contacts(first_name, last_name, email, role, target_id, targets(title, domain))')
      .eq('campaign_id', selectedCampaign.id)
      .then(({ data }) => {
        const contacts = (data ?? []).map((row: any) => ({
          ...row,
          contact: row.contacts ? {
            ...row.contacts,
            targets: row.contacts.targets ?? undefined,
          } : undefined,
        })) as CampaignContact[]
        setCampaignContacts(contacts)
        setContactsLoading(false)
      })

    // Fetch ITP
    if (selectedCampaign.itp_id) {
      supabase
        .from('itp')
        .select('id, name, itp_summary')
        .eq('id', selectedCampaign.itp_id)
        .single()
        .then(({ data }) => {
          setCampaignItp(data as CampaignItp | null)
        })
    }
  }, [selectedCampaign])

  // Real-time subscription for campaign contact updates
  useEffect(() => {
    if (!userDetailsId) return

    const channel = supabase
      .channel(`campaign_updates:${userDetailsId}`)
      .on('broadcast', { event: 'contact_status_change' }, ({ payload }) => {
        setCampaignContacts(prev => prev.map(cc => {
          if (cc.contact_id === payload.contact_id && selectedCampaign?.id === payload.campaign_id) {
            return {
              ...cc,
              status: payload.status,
              reply_body: payload.reply_body ?? cc.reply_body,
              classification: payload.classification ?? cc.classification,
              sent_at: payload.status === 'sent' ? new Date().toISOString() : cc.sent_at,
              opened_at: payload.status === 'opened' ? new Date().toISOString() : cc.opened_at,
              replied_at: payload.status === 'replied' ? new Date().toISOString() : cc.replied_at,
            }
          }
          return cc
        }))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userDetailsId, selectedCampaign?.id])

  const changeCampaignSender = useCallback(async (campaignId: string, senderId: string) => {
    // Update local state immediately
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, sender_id: senderId } : c))
    if (selectedCampaign?.id === campaignId) {
      setSelectedCampaign(prev => prev ? { ...prev, sender_id: senderId } : prev)
    }

    // Add sender to the map if not already there
    const sender = allSenders.find(s => s.id === senderId)
    if (sender) {
      setCampaignSenders(prev => ({ ...prev, [senderId]: sender }))
    }

    // Call backend to update DB + Smartlead
    await fetch(`${API_URL}/api/campaigns/update-sender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId, sender_id: senderId }),
    }).catch(err => console.error('[changeCampaignSender] error:', err))
  }, [selectedCampaign, allSenders])

  const loadMoreContacts = useCallback(async () => {
    if (!selectedCampaign) return
    const { data } = await supabase
      .from('campaign_contacts')
      .select('*, contacts(first_name, last_name, email, role, target_id, targets(title, domain))')
      .eq('campaign_id', selectedCampaign.id)
      .range(campaignContacts.length, campaignContacts.length + CONTACTS_PAGE_SIZE - 1)
    const more = (data ?? []).map((row: any) => ({
      ...row,
      contact: row.contacts ? { ...row.contacts, targets: row.contacts.targets ?? undefined } : undefined,
    })) as CampaignContact[]
    setCampaignContacts(prev => [...prev, ...more])
    setHasMoreContacts(more.length === CONTACTS_PAGE_SIZE)
  }, [selectedCampaign, campaignContacts.length])

  const toggleCampaignStatus = useCallback(async (campaignId: string, newStatus: 'active' | 'paused') => {
    // Optimistic update
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, status: newStatus } : c))
    if (selectedCampaign?.id === campaignId) {
      setSelectedCampaign(prev => prev ? { ...prev, status: newStatus } : prev)
    }

    const res = await fetch(`${API_URL}/api/campaigns/toggle-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId, status: newStatus }),
    })
    if (!res.ok) {
      // Revert on failure
      fetchCampaigns()
    }
  }, [selectedCampaign, fetchCampaigns])

  const refreshContacts = useCallback(async () => {
    if (!selectedCampaign) return
    setContactsLoading(true)
    const { data } = await supabase
      .from('campaign_contacts')
      .select('*, contacts(first_name, last_name, email, role, target_id, targets(title, domain))')
      .eq('campaign_id', selectedCampaign.id)
    const contacts = (data ?? []).map((row: any) => ({
      ...row,
      contact: row.contacts ? { ...row.contacts, targets: row.contacts.targets ?? undefined } : undefined,
    })) as CampaignContact[]
    setCampaignContacts(contacts)
    setContactsLoading(false)
  }, [selectedCampaign])

  const updateCampaign = useCallback(async (campaignId: string, updates: { name?: string; tone?: string; email_sequence?: any[] }) => {
    const res = await fetch(`${API_URL}/api/campaigns/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId, ...updates }),
    })
    if (res.ok) {
      // Refresh to get updated data
      fetchCampaigns()
      if (selectedCampaign?.id === campaignId) {
        setSelectedCampaign(prev => prev ? { ...prev, ...updates } : prev)
      }
    }
    return res.ok
  }, [selectedCampaign, fetchCampaigns])

  return {
    campaigns,
    selectedCampaign,
    setSelectedCampaign,
    campaignContacts,
    campaignItp,
    draperSummary,
    contactsLoading,
    hasMoreContacts,
    loadMoreContacts,
    campaignSenders,
    allSenders,
    changeCampaignSender,
    toggleCampaignStatus,
    updateCampaign,
    refreshCampaigns: fetchCampaigns,
    refreshContacts,
  }
}

import { useState, useEffect, useCallback, useRef } from 'react'
import supabase from '../services/supabase'
import type { Employee, Lead, ITP } from '../types/index'

const API_URL = import.meta.env.VITE_API_URL

const BUFFER_SIZE = 50
const DISPLAY_SIZE = 20
const BUFFER_REFILL_THRESHOLD = 10
const APPROVED_PAGE_SIZE = 25

const LEAD_SELECT = 'id, target_id, itp_id, score, score_reason, approved, rejected, rejection_reason, targets(id, domain, title, link, contacts(id, first_name, last_name, email, role))'

interface UseBelfortParams {
  accountId: string | null
  userDetailsId: string | null
  selectedEmployee: Employee
  firstname?: string
}

export default function useBelfort({ accountId, userDetailsId, selectedEmployee, firstname }: UseBelfortParams) {
  const [belfortItps, setBelfortItps] = useState<Pick<ITP, 'id' | 'name'>[]>([])
  const [belfortSelectedItpId, setBelfortSelectedItpId] = useState<string | null>(null)
  const [belfortSubTab, setBelfortSubTab] = useState<'needs_approval' | 'approved' | 'rejected'>('needs_approval')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null)

  const [belfortSummary, setBelfortSummary] = useState<string | null>(null)
  const [belfortSummaryLoading, setBelfortSummaryLoading] = useState(false)

  // Needs approval: sliding buffer queue
  const [needsApprovalBuffer, setNeedsApprovalBuffer] = useState<Lead[]>([])
  const [needsApprovalTotal, setNeedsApprovalTotal] = useState(0)
  const [bufferLoading, setBufferLoading] = useState(false)
  const naHasMore = useRef(false)
  // IDs already in the buffer — used to exclude from refill fetches to avoid duplicates
  const naBufferIds = useRef<Set<string>>(new Set())

  // Approved: server-side pagination
  const [approvedLeads, setApprovedLeads] = useState<Lead[]>([])
  const [approvedPage, setApprovedPage] = useState(1)
  const [approvedTotal, setApprovedTotal] = useState(0)
  const [approvedLoading, setApprovedLoading] = useState(false)

  // Rejected: server-side pagination
  const [rejectedLeads, setRejectedLeads] = useState<Lead[]>([])
  const [rejectedPage, setRejectedPage] = useState(1)
  const [rejectedTotal, setRejectedTotal] = useState(0)
  const [rejectedLoading, setRejectedLoading] = useState(false)

  // Auto-approve toggle
  const [autoApproveLeads, setAutoApproveLeads] = useState(false)

  const [pendingRefinementCounts, setPendingRefinementCounts] = useState<Record<string, number>>({})
  const [refining, setRefining] = useState(false)

  // Summary fetch
  useEffect(() => {
    if (selectedEmployee.name === 'Belfort' && accountId && !belfortSummary && !belfortSummaryLoading) {
      setBelfortSummaryLoading(true)
      fetch(`${API_URL}/api/messages/belfort-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, firstname }),
      })
        .then(r => r.json())
        .then(data => setBelfortSummary(data.message ?? null))
        .catch(() => {})
        .finally(() => setBelfortSummaryLoading(false))
    }
  }, [selectedEmployee, accountId, belfortSummary, belfortSummaryLoading])

  // Load ITPs
  useEffect(() => {
    if (selectedEmployee.name === 'Belfort' && accountId) {
      supabase.from('itp').select('id, name').eq('account_id', accountId).order('created_at', { ascending: false })
        .then(({ data }) => {
          const itps = (data ?? []) as Pick<ITP, 'id' | 'name'>[]
          setBelfortItps(itps)
          if (itps.length > 0) setBelfortSelectedItpId(itps[0].id)
        })
    }
  }, [selectedEmployee, accountId])

  // Load auto_approve_leads setting
  useEffect(() => {
    if (selectedEmployee.name === 'Belfort' && accountId) {
      supabase.from('account').select('auto_approve_leads').eq('id', accountId).single()
        .then(({ data }) => {
          if (data) setAutoApproveLeads(data.auto_approve_leads ?? false)
        })
    }
  }, [selectedEmployee, accountId])

  const fetchNeedsApprovalBatch = useCallback(async (itpId: string, excludeIds: string[]): Promise<Lead[]> => {
    let query = supabase.from('leads')
      .select(LEAD_SELECT)
      .eq('itp_id', itpId)
      .gte('score', 70)
      .is('approved', null)
      .is('rejected', null)
      .order('score', { ascending: false })
      .limit(BUFFER_SIZE)
    if (excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`)
    }
    const { data } = await query
    return (data ?? []) as unknown as Lead[]
  }, [])

  // Initialise on ITP change
  useEffect(() => {
    if (!belfortSelectedItpId) {
      setNeedsApprovalBuffer([])
      setNeedsApprovalTotal(0)
      setApprovedLeads([])
      setApprovedTotal(0)
      setApprovedPage(1)
      setRejectedLeads([])
      setRejectedTotal(0)
      setRejectedPage(1)
      naHasMore.current = false
      naBufferIds.current = new Set()
      return
    }

    const itpId = belfortSelectedItpId

    const init = async () => {
      setBufferLoading(true)
      naHasMore.current = false
      naBufferIds.current = new Set()

      const [naCountResult, apCountResult, rejCountResult, firstBatch] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .eq('itp_id', itpId).gte('score', 70).is('approved', null).is('rejected', null),
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .eq('itp_id', itpId).gte('score', 70).eq('approved', true),
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .eq('itp_id', itpId).eq('rejected', true),
        fetchNeedsApprovalBatch(itpId, []),
      ])

      setNeedsApprovalTotal(naCountResult.count ?? 0)
      setApprovedTotal(apCountResult.count ?? 0)
      setRejectedTotal(rejCountResult.count ?? 0)
      firstBatch.forEach(l => naBufferIds.current.add(l.id))
      setNeedsApprovalBuffer(firstBatch)
      naHasMore.current = firstBatch.length === BUFFER_SIZE
      setBufferLoading(false)
    }

    setApprovedPage(1)
    setApprovedLeads([])
    setRejectedPage(1)
    setRejectedLeads([])
    init()
  }, [belfortSelectedItpId, fetchNeedsApprovalBatch])

  // Refill buffer when it drops below threshold
  useEffect(() => {
    if (!belfortSelectedItpId || bufferLoading || !naHasMore.current || needsApprovalBuffer.length >= BUFFER_REFILL_THRESHOLD) return

    const itpId = belfortSelectedItpId
    const excludeIds = Array.from(naBufferIds.current)

    setBufferLoading(true)
    fetchNeedsApprovalBatch(itpId, excludeIds).then(batch => {
      batch.forEach(l => naBufferIds.current.add(l.id))
      setNeedsApprovalBuffer(prev => [...prev, ...batch])
      naHasMore.current = batch.length === BUFFER_SIZE
      setBufferLoading(false)
    })
  }, [needsApprovalBuffer.length, belfortSelectedItpId, bufferLoading, fetchNeedsApprovalBatch])

  // Fetch approved page whenever tab, ITP, or page changes
  useEffect(() => {
    if (!belfortSelectedItpId || belfortSubTab !== 'approved') return
    const from = (approvedPage - 1) * APPROVED_PAGE_SIZE
    const to = from + APPROVED_PAGE_SIZE - 1
    setApprovedLoading(true)
    supabase.from('leads')
      .select(LEAD_SELECT)
      .eq('itp_id', belfortSelectedItpId)
      .gte('score', 70)
      .eq('approved', true)
      .order('score', { ascending: false })
      .range(from, to)
      .then(({ data }) => {
        setApprovedLeads((data ?? []) as unknown as Lead[])
        setApprovedLoading(false)
      })
  }, [belfortSelectedItpId, belfortSubTab, approvedPage])

  // If current approved page becomes empty after a rejection, go back one page
  useEffect(() => {
    if (belfortSubTab === 'approved' && approvedLeads.length === 0 && approvedPage > 1 && !approvedLoading) {
      setApprovedPage(p => p - 1)
    }
  }, [approvedLeads.length, approvedPage, belfortSubTab, approvedLoading])

  // Fetch rejected page whenever tab, ITP, or page changes
  useEffect(() => {
    if (!belfortSelectedItpId || belfortSubTab !== 'rejected') return
    const from = (rejectedPage - 1) * APPROVED_PAGE_SIZE
    const to = from + APPROVED_PAGE_SIZE - 1
    setRejectedLoading(true)
    supabase.from('leads')
      .select(LEAD_SELECT)
      .eq('itp_id', belfortSelectedItpId)
      .eq('rejected', true)
      .order('score', { ascending: false })
      .range(from, to)
      .then(({ data }) => {
        setRejectedLeads((data ?? []) as unknown as Lead[])
        setRejectedLoading(false)
      })
  }, [belfortSelectedItpId, belfortSubTab, rejectedPage])

  const checkAndQueueTargetMobilisation = useCallback(async (itpId: string | null) => {
    if (!itpId || !userDetailsId) return
    const { data: leads } = await supabase
      .from('leads')
      .select('id, approved, rejected, rejection_reason')
      .eq('itp_id', itpId)
      .gte('score', 70)
    const approved = (leads ?? []).filter((l: any) => l.approved).length
    const needsApproval = (leads ?? []).filter((l: any) => !l.approved && !l.rejected).length
    console.log('[queue] checkAndQueue: approved=', approved, 'needsApproval=', needsApproval)
    if (needsApproval === 0) {
      if (approved >= 10) {
        const mobilisationToQueue = 'ten_approved_leads_found'
        const { data: ud, error } = await supabase.from('user_details').select('queued_mobilisations').eq('id', userDetailsId).single()
        console.log('[queue] fetched user_details:', ud, error)
        const queue = ud?.queued_mobilisations ?? []
        if (!queue.some((q: any) => q.mobilisation === mobilisationToQueue)) {
          const { error: updateError } = await supabase.from('user_details')
            .update({ queued_mobilisations: [...queue, { mobilisation: mobilisationToQueue, queued_at: new Date().toISOString() }] })
            .eq('id', userDetailsId)
          console.log('[queue] queued', mobilisationToQueue, 'error:', updateError)
        }
      } else {
        const rejected = (leads ?? []).filter((l: any) => l.rejected)
        const withReasons = rejected.filter((l: any) => l.rejection_reason?.trim())
        if (withReasons.length > 0) {
          console.log('[queue] Dispatching itp_refiner with', withReasons.length, 'rejection reasons')
          fetch(`${API_URL}/api/skills/dispatch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employee: 'lead_gen_expert',
              skill: 'itp_refiner',
              user_details_id: userDetailsId,
              inputs: { itp_id: itpId },
            }),
          }).catch(err => console.error('[queue] itp_refiner dispatch error:', err))
        } else {
          const mobilisationToQueue = 'need_ten_more_leads'
          const { data: ud, error } = await supabase.from('user_details').select('queued_mobilisations').eq('id', userDetailsId).single()
          console.log('[queue] fetched user_details:', ud, error)
          const queue = ud?.queued_mobilisations ?? []
          if (!queue.some((q: any) => q.mobilisation === mobilisationToQueue)) {
            const { error: updateError } = await supabase.from('user_details')
              .update({ queued_mobilisations: [...queue, { mobilisation: mobilisationToQueue, queued_at: new Date().toISOString() }] })
              .eq('id', userDetailsId)
            console.log('[queue] queued', mobilisationToQueue, 'error:', updateError)
          }
        }
      }
    }
  }, [userDetailsId])

  const rejectLead = useCallback(async (lead: Lead) => {
    await supabase.from('leads').update({ rejected: true, rejection_reason: lead.rejection_reason ?? null }).eq('id', lead.id)
    naBufferIds.current.delete(lead.id)
    setNeedsApprovalBuffer(prev => prev.filter(l => l.id !== lead.id))
    setNeedsApprovalTotal(prev => Math.max(0, prev - 1))
    setRejectedTotal(prev => prev + 1)
    setSelectedLead(null)
  }, [])

  const approveLead = useCallback(async (lead: Lead) => {
    // Approval goes through the backend so the lead's contacts get pushed to
    // the active campaign for its ITP (campaign_contacts insert + Smartlead
    // sync). Backend logs any push errors; the approval itself always sticks.
    await fetch(`${API_URL}/api/leads/${lead.id}/approve`, { method: 'POST' })
    naBufferIds.current.delete(lead.id)
    setNeedsApprovalBuffer(prev => prev.filter(l => l.id !== lead.id))
    setNeedsApprovalTotal(prev => Math.max(0, prev - 1))
    setApprovedTotal(prev => prev + 1)
    setSelectedLead(null)
  }, [])

  const rejectApprovedLead = useCallback(async (lead: Lead, reason: string) => {
    await supabase.from('leads').update({ approved: false, rejected: true, rejection_reason: reason }).eq('id', lead.id)
    setApprovedLeads(prev => prev.filter(l => l.id !== lead.id))
    setApprovedTotal(prev => Math.max(0, prev - 1))
    setRejectedTotal(prev => prev + 1)
    setSelectedLead(null)
    if (lead.itp_id) {
      setPendingRefinementCounts(prev => ({ ...prev, [lead.itp_id]: (prev[lead.itp_id] ?? 0) + 1 }))
    }
  }, [])

  const toggleAutoApprove = useCallback(async (value: boolean) => {
    if (!accountId) return
    setAutoApproveLeads(value)
    await supabase.from('account').update({ auto_approve_leads: value }).eq('id', accountId)
  }, [accountId])

  const refineItp = useCallback(async (itpId: string): Promise<string | null> => {
    if (!userDetailsId) return null
    setRefining(true)
    try {
      const res = await fetch(`${API_URL}/api/itp/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itp_id: itpId, user_details_id: userDetailsId }),
      })
      const data = await res.json()
      setPendingRefinementCounts(prev => ({ ...prev, [itpId]: 0 }))
      return data.changes_summary ?? null
    } catch (err) {
      console.error('[refineItp]', err)
      return null
    } finally {
      setRefining(false)
    }
  }, [userDetailsId])

  const approvedPageCount = Math.max(1, Math.ceil(approvedTotal / APPROVED_PAGE_SIZE))
  const needsApprovalDisplay = needsApprovalBuffer.slice(0, DISPLAY_SIZE)

  return {
    belfortItps,
    belfortSelectedItpId,
    setBelfortSelectedItpId,
    belfortSubTab,
    setBelfortSubTab,
    selectedLead,
    setSelectedLead,
    expandedLeadId,
    setExpandedLeadId,
    loading: bufferLoading,
    // Needs approval queue
    needsApprovalDisplay,
    needsApprovalTotal,
    // Approved pagination
    approvedLeads,
    approvedPage,
    approvedPageCount,
    approvedTotal,
    approvedLoading,
    setApprovedPage,
    // Rejected pagination
    rejectedLeads,
    rejectedPage,
    rejectedPageCount: Math.max(1, Math.ceil(rejectedTotal / APPROVED_PAGE_SIZE)),
    rejectedTotal,
    rejectedLoading,
    setRejectedPage,
    // Auto-approve
    autoApproveLeads,
    toggleAutoApprove,
    // Summary + refinement
    belfortSummary,
    checkAndQueueTargetMobilisation,
    rejectLead,
    approveLead,
    rejectApprovedLead,
    refineItp,
    pendingRefinementCount: pendingRefinementCounts[belfortSelectedItpId ?? ''] ?? 0,
    refining,
  }
}

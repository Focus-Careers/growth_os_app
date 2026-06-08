import { useCallback, useEffect, useState } from 'react'
import supabase from '../services/supabase'

const API_URL = import.meta.env.VITE_API_URL

export type ProvisioningState =
  | 'PENDING'
  | 'ORDER_PLACED'
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'ORDER_FAILED'
  | 'PROVISIONING_STALLED'
  | 'ROTATING'
  | 'RETIRED'

export interface ProvisioningOrder {
  id: string
  account_id: string
  smartsenders_order_id: string | null
  state: ProvisioningState
  tier: 'basic' | 'growth' | 'scale' | null
  primary_domain: string | null
  selected_domain: string | null
  num_domains: number
  num_mailboxes: number
  vendor_id: string | null
  pre_warmed: boolean
  last_error: string | null
  warmup_started_at: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface Vendor {
  id: string
  name: string
  price?: number
  pre_warmed_price?: number
  [k: string]: unknown
}

interface UseProvisioningArgs {
  accountId: string | null
}

export default function useProvisioning({ accountId }: UseProvisioningArgs) {
  const [orders, setOrders] = useState<ProvisioningOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vendors, setVendors] = useState<Vendor[]>([])

  const fetchOrders = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('provisioning_orders')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
      if (error) throw error
      setOrders((data ?? []) as ProvisioningOrder[])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // Realtime subscription: update orders as poller advances state
  useEffect(() => {
    if (!accountId) return
    const channel = supabase
      .channel(`provisioning_orders:${accountId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'provisioning_orders', filter: `account_id=eq.${accountId}` },
        (payload) => {
          setOrders(prev => {
            if (payload.eventType === 'INSERT') {
              return [payload.new as ProvisioningOrder, ...prev]
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map(o => o.id === (payload.new as ProvisioningOrder).id ? payload.new as ProvisioningOrder : o)
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter(o => o.id !== (payload.old as ProvisioningOrder).id)
            }
            return prev
          })
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [accountId])

  const fetchVendors = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/provisioning/vendors`)
      const data = await res.json()
      setVendors((data?.vendors ?? []) as Vendor[])
    } catch (e: any) {
      console.error('[useProvisioning] vendors error:', e)
    }
  }, [])

  const suggestDomains = useCallback(async (primaryDomain: string): Promise<string[]> => {
    const res = await fetch(`${API_URL}/api/provisioning/suggest-domains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary_domain: primaryDomain }),
    })
    const data = await res.json()
    return (data?.suggestions ?? []) as string[]
  }, [])

  const placeOrder = useCallback(async (input: {
    tier: 'basic' | 'growth' | 'scale'
    primary_domain: string
    selected_domain: string
    vendor_id: string
    pre_warmed?: boolean
    user_details: {
      first_name: string
      last_name: string
      email: string
      phone?: string
      address?: string
      city?: string
      country?: string
      postcode?: string
    }
  }) => {
    if (!accountId) throw new Error('No account id')
    const res = await fetch(`${API_URL}/api/provisioning/place-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, ...input }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error ?? 'place-order failed')
    return data?.order as ProvisioningOrder
  }, [accountId])

  // Helper: short human label for the wizard's status tracker
  const stateLabel = (s: ProvisioningState): string => ({
    PENDING:               'Preparing order',
    ORDER_PLACED:          'Order placed — waiting on registrar',
    PROVISIONING:          'Provisioning domain & mailboxes',
    ACTIVE:                'Mailboxes live — warming up',
    ORDER_FAILED:          'Order failed',
    PROVISIONING_STALLED:  'Provisioning stalled — check vendor',
    ROTATING:              'Rotating mailboxes',
    RETIRED:               'Retired',
  }[s])

  return {
    orders,
    loading,
    error,
    vendors,
    refresh: fetchOrders,
    fetchVendors,
    suggestDomains,
    placeOrder,
    stateLabel,
  }
}

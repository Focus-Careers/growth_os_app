import { useCallback, useEffect, useState } from 'react'
import supabase from '../services/supabase'

const API_URL = import.meta.env.VITE_API_URL

interface SenderRow {
  id: string
  email: string
  display_name: string | null
  verified: boolean
  warmup_started_at: string | null
  connection_type: 'manual' | 'provisioned'
  verification_error: string | null
  daily_capacity: number
}

interface Props {
  campaignId: string
  accountId: string | null
  onChange?: () => void
}

export default function CampaignSenderPills({ campaignId, accountId, onChange }: Props) {
  const [senders, setSenders] = useState<SenderRow[]>([])
  const [totalCapacity, setTotalCapacity] = useState(0)
  const [allSenders, setAllSenders] = useState<{ id: string; email: string; verified: boolean }[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/campaigns/${campaignId}/senders`)
    const data = await res.json()
    setSenders((data?.senders ?? []) as SenderRow[])
    setTotalCapacity(data?.total_daily_capacity ?? 0)
  }, [campaignId])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!accountId) return
    supabase
      .from('senders')
      .select('id, email, verified')
      .eq('account_id', accountId)
      .then(({ data }) => setAllSenders((data ?? []) as { id: string; email: string; verified: boolean }[]))
  }, [accountId])

  const attachedIds = new Set(senders.map(s => s.id))
  const available = allSenders.filter(s => !attachedIds.has(s.id))

  async function addSender(senderId: string) {
    await fetch(`${API_URL}/api/campaigns/${campaignId}/senders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_id: senderId }),
    })
    setPickerOpen(false)
    refresh()
    onChange?.()
  }

  async function removeSender(senderId: string) {
    await fetch(`${API_URL}/api/campaigns/${campaignId}/senders/${senderId}`, { method: 'DELETE' })
    refresh()
    onChange?.()
  }

  return (
    <div>
      <div className="sender-pills">
        {senders.map(s => {
          const warming = !!s.warmup_started_at && s.daily_capacity < 50
          return (
            <span key={s.id} className="sender-pill" title={s.verification_error ?? undefined}>
              <span className="sender-pill__email">{s.email}</span>
              <span className={`sender-pill__badge ${warming ? 'sender-pill__badge--warming' : ''}`}>
                {warming ? 'warming' : 'ready'}
              </span>
              <span className="sender-pill__capacity">{s.daily_capacity}/day</span>
              <button
                onClick={() => removeSender(s.id)}
                className="sender-pill__remove"
                aria-label={`Remove ${s.email}`}
              >×</button>
            </span>
          )
        })}

        {!pickerOpen && available.length > 0 && (
          <button className="sender-pill__add" onClick={() => setPickerOpen(true)}>+ Add sender</button>
        )}

        {pickerOpen && (
          <select
            autoFocus
            className="sender-pill__add"
            onChange={(e) => { if (e.target.value) addSender(e.target.value) }}
            onBlur={() => setPickerOpen(false)}
            defaultValue=""
          >
            <option value="" disabled>Pick a sender…</option>
            {available.map(s => (
              <option key={s.id} value={s.id}>{s.email}{!s.verified ? ' (unverified)' : ''}</option>
            ))}
          </select>
        )}
      </div>
      <div className="sender-capacity-summary">
        Combined capacity: <strong>{totalCapacity}/day</strong>
        {senders.length > 1 && ` across ${senders.length} senders`}
      </div>
    </div>
  )
}

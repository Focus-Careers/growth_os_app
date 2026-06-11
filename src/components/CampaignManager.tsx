import React, { useState, useEffect, useMemo, useRef } from 'react'
import type { Campaign, CampaignContact, CampaignItp, CampaignSender } from '../hooks/useCampaigns'
import { htmlToText } from '../utils/html'

const API_URL = import.meta.env.VITE_API_URL
const PRESET_SMTP_HOSTS = new Set(['smtp.gmail.com', 'smtp.office365.com', 'smtp.mail.yahoo.com'])

function BodyEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value
    }
  }, [value])
  return (
    <div
      ref={ref}
      className="campaign-sequence-body campaign-sequence-body--editing"
      contentEditable
      suppressContentEditableWarning
      onBlur={() => { if (ref.current) onChange(ref.current.innerHTML) }}
    />
  )
}

interface CampaignManagerProps {
  campaigns: Campaign[]
  selectedCampaign: Campaign | null
  onSelectCampaign: (campaign: Campaign | null) => void
  campaignContacts: CampaignContact[]
  campaignItp: CampaignItp | null
  selectedContact: CampaignContact | null
  onSelectContact: (contact: CampaignContact | null) => void
  draperSummary: string | null
  contactsLoading?: boolean
  campaignSenders: Record<string, CampaignSender>
  allSenders: CampaignSender[]
  onChangeSender: (campaignId: string, senderId: string) => Promise<void>
  onToggleStatus: (campaignId: string, status: 'active' | 'paused') => Promise<void>
  onUpdateCampaign: (campaignId: string, updates: { name?: string; tone?: string; email_sequence?: any[] }) => Promise<boolean>
  hasMoreContacts?: boolean
  onLoadMoreContacts?: () => void
  onRefresh?: () => void
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTimestamp(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

const PIPELINE_COLUMNS = [
  { key: 'pending', label: 'Queued', colour: 'var(--muted)' },
  { key: 'sent', label: 'Sent', colour: 'var(--accent)' },
  { key: 'opened', label: 'Opened', colour: '#4a8c5c' },
  { key: 'replied', label: 'Replied', colour: '#2b7ec4' },
  { key: 'bounced', label: 'Bounced', colour: '#c44e2b' },
] as const

const CampaignManager: React.FC<CampaignManagerProps> = ({
  campaigns,
  selectedCampaign,
  onSelectCampaign,
  campaignContacts,
  campaignItp,
  selectedContact,
  onSelectContact,
  draperSummary,
  contactsLoading,
  campaignSenders,
  allSenders,
  onChangeSender,
  onToggleStatus,
  onUpdateCampaign,
  hasMoreContacts,
  onLoadMoreContacts,
  onRefresh,
}) => {
  const [activeEmailTab, setActiveEmailTab] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editTone, setEditTone] = useState('')
  const [editSequence, setEditSequence] = useState<{ seq_number: number; delay_in_days: number; subject: string; body: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [parsedSequence, setParsedSequence] = useState<{ seq_number: number; delay_in_days: number; subject: string; body: string }[]>([])
  const [changingSender, setChangingSender] = useState(false)
  const [pendingSenderId, setPendingSenderId] = useState<string>('')
  const [savingSender, setSavingSender] = useState(false)
  const [editingSenderCreds, setEditingSenderCreds] = useState(false)
  const [senderCredsEmail, setSenderCredsEmail] = useState('')
  const [senderCredsDisplayName, setSenderCredsDisplayName] = useState('')
  const [senderCredsPassword, setSenderCredsPassword] = useState('')
  const [senderCredsSmtpHost, setSenderCredsSmtpHost] = useState('')
  const [senderCredsSmtpPort, setSenderCredsSmtpPort] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)

  // Parse email sequence once when campaign changes — reset tab index
  useEffect(() => {
    setActiveEmailTab(0)
    if (!selectedCampaign) { setParsedSequence([]); return }
    const raw = selectedCampaign.email_sequence
    if (Array.isArray(raw) && raw.length > 0) { setParsedSequence(raw); return }
    if (typeof raw === 'string') {
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) { setParsedSequence(parsed); return } } catch {}
    }
    if (selectedCampaign.email_template) {
      setParsedSequence([{ seq_number: 1, delay_in_days: 0, subject: selectedCampaign.subject_line ?? '', body: selectedCampaign.email_template }])
      return
    }
    setParsedSequence([])
  }, [selectedCampaign?.id])

  const stats = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const cc of campaignContacts) {
      counts[cc.status] = (counts[cc.status] ?? 0) + 1
    }
    const pending = counts['pending'] ?? 0
    return {
      total: campaignContacts.length,
      pending,
      // Sent = everyone who has been contacted (total minus still queued)
      sent: campaignContacts.length - pending,
      opened: counts['opened'] ?? 0,
      replied: counts['replied'] ?? 0,
      bounced: (counts['bounced'] ?? 0) + (counts['failed'] ?? 0) + (counts['unsubscribed'] ?? 0),
    }
  }, [campaignContacts])

  const grouped = useMemo(() => {
    const groups: Record<string, CampaignContact[]> = {}
    for (const col of PIPELINE_COLUMNS) groups[col.key] = []
    for (const cc of campaignContacts) {
      const key = ['failed', 'unsubscribed'].includes(cc.status) ? 'bounced' : cc.status
      if (groups[key]) groups[key].push(cc)
      else groups['pending'].push(cc)
    }
    return groups
  }, [campaignContacts])

  // Campaign list view
  if (!selectedCampaign) {
    return (
      <div id="main-body" className="campaign-list">
        <div className="draper-summary">
          <div className="agent-label">DRAPER</div>
          {draperSummary ? (
            <div className="draper-summary-bubble msg-animate">{draperSummary}</div>
          ) : (
            <div className="typing-dots">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          )}
        </div>
        {draperSummary && <hr className="draper-divider" />}
        {campaigns.length === 0 ? (
          <div className="campaign-empty-state">
            <div className="campaign-empty-icon">▽</div>
            <div className="campaign-empty-title">No campaigns yet</div>
            <div className="campaign-empty-text">When you're ready to start outreach, ask Watson to create a campaign. He'll walk you through setting up the email sequence, tone, and targets.</div>
          </div>
        ) : (
          campaigns.map(campaign => {
            const s = campaign.stats ?? { sent: 0, opened: 0, replied: 0, bounced: 0 }
            const total = campaign.contact_count ?? 0
            const totalSent = s.sent  // total email sends across all sequences
            return (
              <div key={campaign.id} className="campaign-card" onClick={() => onSelectCampaign(campaign)}>
                <div className="campaign-card-top">
                  <div>
                    <div className="campaign-card-name">{campaign.name}</div>
                    <div className="campaign-card-subject">{campaign.subject_line ?? 'No subject line'}</div>
                  </div>
                  <span className={`campaign-status ${campaign.status}`}>{campaign.status}</span>
                </div>

                <div className="campaign-card-meta-row">
                  <div className="campaign-card-meta-item">
                    <span className="campaign-card-meta-value">{total}</span>
                    <span className="campaign-card-meta-label">Contacts</span>
                  </div>
                  <div className="campaign-card-meta-item">
                    <span className="campaign-card-meta-value">{campaign.num_emails}</span>
                    <span className="campaign-card-meta-label">Emails</span>
                  </div>
                  <div className="campaign-card-meta-item">
                    <span className="campaign-card-meta-value" style={{ color: 'var(--accent)' }}>{totalSent}</span>
                    <span className="campaign-card-meta-label">Sent</span>
                  </div>
                  <div className="campaign-card-meta-item">
                    <span className="campaign-card-meta-value" style={{ color: '#4a8c5c' }}>{s.opened}</span>
                    <span className="campaign-card-meta-label">Opened</span>
                  </div>
                  <div className="campaign-card-meta-item">
                    <span className="campaign-card-meta-value" style={{ color: '#2b7ec4' }}>{s.replied}</span>
                    <span className="campaign-card-meta-label">Replied</span>
                  </div>
                </div>

                <div className="campaign-card-footer">
                  {campaign.tone && <span className="campaign-card-tag">{campaign.tone}</span>}
                  {campaign.sender_id && campaignSenders[campaign.sender_id] && (
                    <span className="campaign-card-tag campaign-card-sender">{campaignSenders[campaign.sender_id].email}</span>
                  )}
                  <span className="campaign-card-date">{formatDate(campaign.created_at)}</span>
                </div>
              </div>
            )
          })
        )}
      </div>
    )
  }

  return (
    <div id="main-body" className="campaign-detail">
      {/* Header */}
      <div className="campaign-detail-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="campaign-back-btn" onClick={() => onSelectCampaign(null)}>&larr; Back</button>
          {editing ? (
            <input className="campaign-edit-name" value={editName} onChange={e => setEditName(e.target.value)} />
          ) : (
            <span className="campaign-detail-name">{selectedCampaign.name}</span>
          )}
          <span className={`campaign-status ${selectedCampaign.status}`}>{selectedCampaign.status}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && onRefresh && (
            <button className="campaign-edit-btn" onClick={onRefresh} title="Refresh — pulls latest sends from Smartlead">↻ Refresh</button>
          )}
          {!editing && (
            <button className="campaign-edit-btn" onClick={() => {
              setEditName(selectedCampaign.name)
              setEditTone(selectedCampaign.tone ?? '')
              setEditSequence(parsedSequence.map(e => ({ ...e })))
              setEditing(true)
            }}>Edit</button>
          )}
          {editing && (
            <>
              <button className="campaign-save-btn" disabled={saving} onClick={async () => {
                setSaving(true)
                const ok = await onUpdateCampaign(selectedCampaign.id, {
                  name: editName,
                  tone: editTone,
                  email_sequence: editSequence,
                })
                setSaving(false)
                if (ok) {
                  setParsedSequence(editSequence)
                  setEditing(false)
                }
              }}>{saving ? 'Saving...' : 'Save'}</button>
              <button className="campaign-cancel-btn" onClick={() => setEditing(false)}>Cancel</button>
            </>
          )}
          {!editing && selectedCampaign.status === 'active' && (
            <button className="campaign-pause-btn" onClick={() => onToggleStatus(selectedCampaign.id, 'paused')}>Pause</button>
          )}
          {!editing && (selectedCampaign.status === 'paused' || selectedCampaign.status === 'draft' || selectedCampaign.status === 'synced_not_active') && (
            <button className="campaign-resume-btn" onClick={() => onToggleStatus(selectedCampaign.id, 'active')}>
              {selectedCampaign.status === 'paused' ? 'Resume' : 'Activate'}
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="campaign-stats-row">
        <div className="campaign-stat">
          <span className="campaign-stat-value">{stats.total}</span>
          <span className="campaign-stat-label">Contacts</span>
        </div>
        <div className="campaign-stat">
          <span className="campaign-stat-value" style={{ color: 'var(--accent)' }}>{stats.sent}</span>
          <span className="campaign-stat-label">Sent</span>
        </div>
        <div className="campaign-stat">
          <span className="campaign-stat-value" style={{ color: '#4a8c5c' }}>{stats.opened}</span>
          <span className="campaign-stat-label">Opened</span>
        </div>
        <div className="campaign-stat">
          <span className="campaign-stat-value" style={{ color: '#2b7ec4' }}>{stats.replied}</span>
          <span className="campaign-stat-label">Replied</span>
        </div>
        <div className="campaign-stat">
          <span className="campaign-stat-value" style={{ color: '#c44e2b' }}>{stats.bounced}</span>
          <span className="campaign-stat-label">Bounced</span>
        </div>
      </div>

      {/* Campaign meta */}
      <div className="campaign-meta-row">
        {campaignItp && (
          <div className="campaign-meta-item">
            <span className="campaign-meta-label">Target Profile</span>
            <span className="campaign-meta-value">{campaignItp.name ?? 'Unnamed ITP'}</span>
          </div>
        )}
        <div className="campaign-meta-item">
          <span className="campaign-meta-label">Tone</span>
          {editing ? (
            <select className="campaign-edit-tone" value={editTone} onChange={e => setEditTone(e.target.value)}>
              <option value="Professional">Professional</option>
              <option value="Friendly & casual">Friendly & casual</option>
              <option value="Direct & punchy">Direct & punchy</option>
            </select>
          ) : (
            <span className="campaign-meta-value">{selectedCampaign.tone ?? '—'}</span>
          )}
        </div>
        <div className="campaign-meta-item">
          <span className="campaign-meta-label">Emails in Sequence</span>
          <span className="campaign-meta-value">{selectedCampaign.num_emails}</span>
        </div>
        <div className="campaign-meta-item">
          <span className="campaign-meta-label">Sender</span>
          {(() => {
            const currentSender = selectedCampaign.sender_id ? campaignSenders[selectedCampaign.sender_id] : null
            const isCustomSender = currentSender ? !PRESET_SMTP_HOSTS.has(currentSender.smtp_host ?? '') : false
            const hasError = currentSender && currentSender.verified === false && currentSender.verification_error

            if (changingSender) {
              return (
                <div className="campaign-sender-change">
                  <select className="campaign-sender-select" value={pendingSenderId} onChange={e => setPendingSenderId(e.target.value)}>
                    <option value="">Select sender...</option>
                    {allSenders.map(s => (
                      <option key={s.id} value={s.id}>{s.display_name ? `${s.display_name} (${s.email})` : s.email}</option>
                    ))}
                  </select>
                  <div className="campaign-sender-actions">
                    <button className="campaign-sender-save" disabled={!pendingSenderId || savingSender} onClick={async () => {
                      setSavingSender(true)
                      await onChangeSender(selectedCampaign.id, pendingSenderId)
                      setSavingSender(false)
                      setChangingSender(false)
                    }}>{savingSender ? 'Saving...' : 'Save'}</button>
                    <button className="campaign-sender-cancel" disabled={savingSender} onClick={() => setChangingSender(false)}>Cancel</button>
                  </div>
                </div>
              )
            }

            if (editingSenderCreds && currentSender) {
              return (
                <div className="sender-creds-form">
                  <label className="sender-field-label">Display Name</label>
                  <input className="sender-create-input" type="text" value={senderCredsDisplayName} onChange={e => setSenderCredsDisplayName(e.target.value)} placeholder="e.g. John from Acme" />
                  <label className="sender-field-label">Email Address</label>
                  <input className="sender-create-input" type="email" value={senderCredsEmail} onChange={e => setSenderCredsEmail(e.target.value)} placeholder="your@email.com" />
                  <label className="sender-field-label">{isCustomSender ? 'SMTP Password' : 'App Password'}</label>
                  <input className="sender-create-input" type="password" value={senderCredsPassword} onChange={e => setSenderCredsPassword(e.target.value)} placeholder="Paste your password here" />
                  {isCustomSender && (
                    <>
                      <label className="sender-field-label">SMTP Host</label>
                      <input className="sender-create-input" type="text" value={senderCredsSmtpHost} onChange={e => setSenderCredsSmtpHost(e.target.value)} placeholder="smtp.yourprovider.com" />
                      <label className="sender-field-label">SMTP Port</label>
                      <input className="sender-create-input" type="text" value={senderCredsSmtpPort} onChange={e => setSenderCredsSmtpPort(e.target.value)} placeholder="587" />
                    </>
                  )}
                  <div className="campaign-sender-actions">
                    <button className="campaign-sender-save" disabled={!senderCredsPassword.trim() || savingCreds} onClick={async () => {
                      setSavingCreds(true)
                      try {
                        const body: Record<string, string> = {
                          email: senderCredsEmail,
                          display_name: senderCredsDisplayName,
                          smtp_password: senderCredsPassword,
                        }
                        if (isCustomSender) {
                          body.smtp_host = senderCredsSmtpHost
                          body.smtp_port = senderCredsSmtpPort
                        }
                        await fetch(`${API_URL}/api/senders/${currentSender.id}/credentials`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(body),
                        })
                        setEditingSenderCreds(false)
                        onRefresh?.()
                      } finally {
                        setSavingCreds(false)
                      }
                    }}>{savingCreds ? 'Saving...' : 'Save'}</button>
                    <button className="campaign-sender-cancel" disabled={savingCreds} onClick={() => setEditingSenderCreds(false)}>Cancel</button>
                  </div>
                </div>
              )
            }

            return (
              <div>
                <span className="campaign-meta-value">
                  {currentSender
                    ? `${currentSender.display_name ? currentSender.display_name + ' — ' : ''}${currentSender.email}`
                    : 'No sender assigned'
                  }
                  <button className="campaign-sender-change-btn" onClick={() => {
                    setPendingSenderId(selectedCampaign.sender_id ?? '')
                    setChangingSender(true)
                  }}>Change</button>
                </span>
                {hasError && (
                  <div className="sender-error-banner">
                    <span className="sender-error-text">⚠ {currentSender.verification_error}</span>
                    <button className="sender-error-edit-btn" onClick={() => {
                      setSenderCredsEmail(currentSender.email)
                      setSenderCredsDisplayName(currentSender.display_name ?? '')
                      setSenderCredsPassword('')
                      setSenderCredsSmtpHost(currentSender.smtp_host ?? '')
                      setSenderCredsSmtpPort('587')
                      setEditingSenderCreds(true)
                    }}>Edit credentials</button>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Email sequence viewer */}
      {parsedSequence.length > 0 && (
        <div className="campaign-sequence">
          <div className="campaign-sequence-tabs">
            {parsedSequence.map((email, i) => (
              <button
                key={i}
                className={`campaign-sequence-tab${activeEmailTab === i ? ' active' : ''}`}
                onClick={() => setActiveEmailTab(i)}
              >
                {i === 0 ? 'Initial' : `Follow-up ${i}`}
                {email.delay_in_days > 0 && <span className="campaign-sequence-delay">+{email.delay_in_days}d</span>}
              </button>
            ))}
          </div>
          <div className="campaign-sequence-content">
            {editing ? (
              <input
                className="campaign-edit-subject"
                value={editSequence[activeEmailTab]?.subject ?? ''}
                onChange={e => {
                  const updated = [...editSequence]
                  updated[activeEmailTab] = { ...updated[activeEmailTab], subject: e.target.value }
                  setEditSequence(updated)
                }}
              />
            ) : (
              <div className="campaign-sequence-subject">{parsedSequence[activeEmailTab]?.subject}</div>
            )}
            {editing ? (
              <BodyEditor
                value={editSequence[activeEmailTab]?.body ?? ''}
                onChange={html => {
                  const updated = [...editSequence]
                  updated[activeEmailTab] = { ...updated[activeEmailTab], body: html }
                  setEditSequence(updated)
                }}
              />
            ) : (
              <div className="campaign-sequence-body" dangerouslySetInnerHTML={{ __html: parsedSequence[activeEmailTab]?.body ?? '' }} />
            )}
          </div>
        </div>
      )}

      {/* Pipeline Kanban */}
      <div className="campaign-pipeline">
        <div className="campaign-meta-label" style={{ marginBottom: 12 }}>Pipeline</div>
        {contactsLoading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic', padding: '12px 0' }}>Loading contacts...</div>
        ) : (
        <div className="campaign-kanban">
          {PIPELINE_COLUMNS.map(col => (
            <div key={col.key} className="kanban-column">
              <div className="kanban-column-header">
                <span className="kanban-column-title" style={{ color: col.colour }}>{col.label}</span>
                <span className="kanban-column-count">{grouped[col.key]?.length ?? 0}</span>
              </div>
              <div className="kanban-column-body">
                {(grouped[col.key] ?? []).map(cc => (
                  <div
                    key={cc.id}
                    className={`kanban-card${selectedContact?.id === cc.id ? ' kanban-card-selected' : ''}${cc.classification === 'positive' ? ' kanban-card-positive' : cc.classification === 'negative' ? ' kanban-card-negative' : ''}`}
                    style={{ borderLeftColor: cc.classification === 'positive' ? '#4a8c5c' : cc.classification === 'negative' ? '#c44e2b' : col.colour, cursor: 'pointer' }}
                    onClick={() => onSelectContact(selectedContact?.id === cc.id ? null : cc)}
                  >
                    <div className="kanban-card-name">
                      {cc.contact?.first_name || cc.contact?.last_name
                        ? `${cc.contact.first_name ?? ''} ${cc.contact.last_name ?? ''}`.trim()
                        : cc.contact?.email ?? cc.contact?.targets?.title ?? '—'}
                    </div>
                    {cc.contact?.targets?.title && (
                      <div className="kanban-card-company">{cc.contact.targets.title}</div>
                    )}
                    {cc.contact?.role && (
                      <div className="kanban-card-role">{cc.contact.role}</div>
                    )}
                    {cc.reply_body && (() => {
                      const replyText = htmlToText(cc.reply_body)
                      return <div className="kanban-card-reply">{replyText.slice(0, 60)}{replyText.length > 60 ? '...' : ''}</div>
                    })()}
                    {cc.sent_at && col.key !== 'pending' && !cc.reply_body && (
                      <div className="kanban-card-time">{formatTimestamp(col.key === 'replied' && cc.replied_at ? cc.replied_at : col.key === 'opened' && cc.opened_at ? cc.opened_at : cc.sent_at)}</div>
                    )}
                    {cc.current_sequence != null && parsedSequence.length > 0 && (
                      <div className="kanban-card-sequence">
                        {parsedSequence.map((_, i) => (
                          <span
                            key={i}
                            style={{
                              width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                              background: i < cc.current_sequence! ? col.colour : 'var(--border)',
                              marginRight: 3,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {(grouped[col.key] ?? []).length === 0 && (
                  <div className="kanban-empty">No contacts</div>
                )}
              </div>
            </div>
          ))}
        </div>
        )}
        {hasMoreContacts && (
          <button className="load-more-btn" onClick={onLoadMoreContacts}>Load more contacts</button>
        )}
      </div>
    </div>
  )
}

export default CampaignManager

import React, { useState, useEffect } from 'react'
import supabase from '../services/supabase'

interface Sender {
  id: string
  email: string
  display_name: string | null
  smtp_host: string | null
  verified: boolean
}

interface SelectSenderSidebarProps {
  accountId: string | null
  onSelect: (senderId: string) => void
}

import gmailLogo from '../assets/gmail.png'
import outlookLogo from '../assets/outlook.png'
import yahooLogo from '../assets/yahoo.png'

type Provider = 'gmail' | 'outlook' | 'microsoft365' | 'yahoo' | 'custom'

const PROVIDER_ICONS: Record<Provider, React.ReactNode> = {
  gmail: <img src={gmailLogo} alt="Gmail" className="sender-provider-logo" />,
  outlook: <img src={outlookLogo} alt="Outlook" className="sender-provider-logo" />,
  microsoft365: <img src={outlookLogo} alt="Microsoft 365" className="sender-provider-logo" />,
  yahoo: <img src={yahooLogo} alt="Yahoo" className="sender-provider-logo" />,
  custom: (
    <svg className="sender-provider-logo" width="32" height="32" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="var(--muted)" strokeWidth="1.5"/>
      <path d="M2 6L12 13L22 6" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
}

const PROVIDERS: { id: Provider; name: string; domains: string[]; smtp_host: string; smtp_port: number; imap_host: string; imap_port: number; instructions: string[] }[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    instructions: [
      'Go to myaccount.google.com/security',
      'Enable 2-Step Verification if not already on',
      'Search for "App passwords" in the security page',
      'Create a new app password (select "Mail")',
      'Copy the 16-character password and paste it below',
    ],
  },
  {
    id: 'outlook',
    name: 'Outlook (Personal)',
    domains: ['outlook.com', 'hotmail.com', 'live.com'],
    smtp_host: 'smtp.office365.com',
    smtp_port: 587,
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    instructions: [
      'Go to account.microsoft.com/security',
      'Enable two-step verification',
      'Under "App passwords", create a new one',
      'Copy the generated password and paste it below',
    ],
  },
  {
    id: 'microsoft365',
    name: 'Microsoft 365 (Work)',
    domains: [],
    smtp_host: 'smtp.office365.com',
    smtp_port: 587,
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    instructions: [
      'Ask your Microsoft 365 admin to enable SMTP AUTH and IMAP for your mailbox: M365 Admin Center → Users → Active users → [your email] → Mail → Manage email apps → enable both "Authenticated SMTP" and "IMAP"',
      'If your account has MFA enabled, go to mysignins.microsoft.com → Security info → Add method → App password, and use the generated password below',
      'If no MFA, use your regular Microsoft 365 password below',
    ],
  },
  {
    id: 'yahoo',
    name: 'Yahoo',
    domains: ['yahoo.com', 'yahoo.co.uk'],
    smtp_host: 'smtp.mail.yahoo.com',
    smtp_port: 587,
    imap_host: 'imap.mail.yahoo.com',
    imap_port: 993,
    instructions: [
      'Go to login.yahoo.com/account/security',
      'Enable two-step verification',
      'Scroll down to "Generate app password"',
      'Select "Other App" and generate a password',
      'Copy the password and paste it below',
    ],
  },
]

const SelectSenderSidebar: React.FC<SelectSenderSidebarProps> = ({
  accountId,
  onSelect,
}) => {
  const [senders, setSenders] = useState<Sender[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [selecting, setSelecting] = useState(false)

  // Form fields
  const [newEmail, setNewEmail] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!accountId) return
    ;(async () => {
      const { data } = await supabase
        .from('senders')
        .select('*')
        .eq('account_id', accountId)
      setSenders(data ?? [])
      setLoading(false)
    })()
  }, [accountId])

  function selectProvider(provider: Provider) {
    setSelectedProvider(provider)
    const preset = PROVIDERS.find(p => p.id === provider)
    if (preset) {
      setSmtpHost(preset.smtp_host)
      setSmtpPort(String(preset.smtp_port))
      setImapHost(preset.imap_host)
      setImapPort(String(preset.imap_port))
    } else {
      setSmtpHost('')
      setSmtpPort('587')
      setImapHost('')
      setImapPort('993')
    }
    setSmtpPassword('')
    setNewEmail('')
    setNewDisplayName('')
  }

  async function handleCreateSender() {
    if (!newEmail.trim() || !smtpHost.trim() || !smtpPassword.trim() || !accountId) return
    setCreating(true)
    const { data } = await supabase
      .from('senders')
      .insert({
        account_id: accountId,
        email: newEmail.trim().toLowerCase(),
        display_name: newDisplayName.trim() || null,
        smtp_host: smtpHost.trim(),
        smtp_port: parseInt(smtpPort) || 587,
        smtp_username: newEmail.trim().toLowerCase(),
        smtp_password: smtpPassword.trim(),
        imap_host: imapHost.trim() || null,
        imap_port: parseInt(imapPort) || 993,
        provider: 'smartlead',
        verified: false,
      })
      .select('id')
      .single()
    setCreating(false)
    if (data) { setSelecting(true); onSelect(data.id) }
  }

  if (loading) {
    return <div className="sender-empty">Loading senders...</div>
  }

  const activePreset = PROVIDERS.find(p => p.id === selectedProvider)

  return (
    <div className="sender-sidebar">
      {senders.length > 0 && (
        <>
          <div className="sender-section-label">Existing Senders</div>
          {senders.map(sender => (
            <div
              key={sender.id}
              className="sender-card"
              onClick={() => { if (selecting) return; setSelecting(true); onSelect(sender.id) }}
            >
              <div className="sender-card-email">{sender.email}</div>
              {sender.display_name && (
                <div className="sender-card-name">{sender.display_name}</div>
              )}
            </div>
          ))}
          <hr className="sender-divider" />
        </>
      )}

      <div className="sender-section-label">
        {senders.length > 0 ? 'Add New Sender' : 'Connect Your Email'}
      </div>

      {!selectedProvider ? (
        <div className="sender-provider-grid">
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              className="sender-provider-card"
              onClick={() => selectProvider(p.id)}
            >
              {PROVIDER_ICONS[p.id]}
              <span className="sender-provider-name">{p.name}</span>
              <span className="sender-provider-domains">{p.id === 'microsoft365' ? 'Work / custom domain' : p.domains.join(', ')}</span>
            </button>
          ))}
          <button
            className="sender-provider-card"
            onClick={() => selectProvider('custom')}
          >
            {PROVIDER_ICONS.custom}
            <span className="sender-provider-name">Custom</span>
            <span className="sender-provider-domains">Any other provider</span>
          </button>
        </div>
      ) : (
        <div className="sender-setup">
          <button className="sender-back-btn" onClick={() => setSelectedProvider(null)}>
            &larr; Back to providers
          </button>

          <div className="sender-setup-title">
            {selectedProvider === 'custom' ? 'Custom Provider' : `${activePreset?.name} Setup`}
          </div>

          {activePreset && (
            <div className="sender-instructions">
              <div className="sender-instructions-heading">
                {selectedProvider === 'microsoft365' ? 'Setup instructions' : 'How to get your app password'}
              </div>
              <ol className="sender-instructions-list">
                {activePreset.instructions.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="sender-create-form">
            <label className="sender-field-label">Email Address</label>
            <input
              className="sender-create-input"
              type="email"
              placeholder="your@email.com"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
            />

            <label className="sender-field-label">Display Name</label>
            <input
              className="sender-create-input"
              type="text"
              placeholder="e.g. John from Acme"
              value={newDisplayName}
              onChange={e => setNewDisplayName(e.target.value)}
            />

            <label className="sender-field-label">
              {selectedProvider === 'microsoft365' ? 'Password' : 'App Password'}
            </label>
            <input
              className="sender-create-input"
              type="password"
              placeholder={selectedProvider === 'microsoft365' ? 'Your Microsoft 365 password or app password' : activePreset ? 'Paste your app password here' : 'SMTP password'}
              value={smtpPassword}
              onChange={e => setSmtpPassword(e.target.value)}
            />

            {selectedProvider === 'custom' && (
              <>
                <label className="sender-field-label">SMTP Host</label>
                <input
                  className="sender-create-input"
                  type="text"
                  placeholder="e.g. smtp.yourprovider.com"
                  value={smtpHost}
                  onChange={e => setSmtpHost(e.target.value)}
                />

                <label className="sender-field-label">SMTP Port</label>
                <input
                  className="sender-create-input"
                  type="text"
                  placeholder="587"
                  value={smtpPort}
                  onChange={e => setSmtpPort(e.target.value)}
                />

                <label className="sender-field-label">IMAP Host</label>
                <input
                  className="sender-create-input"
                  type="text"
                  placeholder="e.g. imap.yourprovider.com"
                  value={imapHost}
                  onChange={e => setImapHost(e.target.value)}
                />

                <label className="sender-field-label">IMAP Port</label>
                <input
                  className="sender-create-input"
                  type="text"
                  placeholder="993"
                  value={imapPort}
                  onChange={e => setImapPort(e.target.value)}
                />
              </>
            )}

            <button
              className="sender-create-btn"
              onClick={handleCreateSender}
              disabled={!newEmail.trim() || !smtpHost.trim() || !smtpPassword.trim() || creating}
            >
              {creating ? 'Connecting...' : 'Connect Sender'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default SelectSenderSidebar

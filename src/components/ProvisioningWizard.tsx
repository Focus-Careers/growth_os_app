import { useEffect, useMemo, useState } from 'react'
import useProvisioning, { ProvisioningOrder, ProvisioningState, Vendor } from '../hooks/useProvisioning'

interface ProvisioningWizardProps {
  accountId: string | null
  onClose?: () => void
  defaultPrimaryDomain?: string
  defaultUserDetails?: Partial<{
    first_name: string
    last_name: string
    email: string
    phone: string
    address: string
    city: string
    country: string
    postcode: string
  }>
}

type Step = 'tier' | 'primary-domain' | 'pick-domain' | 'confirm' | 'status'

const TIERS: { id: 'basic' | 'growth' | 'scale'; name: string; domains: number; mailboxes: number; prospects: string; price: string }[] = [
  { id: 'basic',  name: 'Basic',  domains: 1,  mailboxes: 2,  prospects: '~550/mo',   price: '~$10/mo' },
  { id: 'growth', name: 'Growth', domains: 3,  mailboxes: 6,  prospects: '~1,650/mo', price: '~$30/mo' },
  { id: 'scale',  name: 'Scale',  domains: 10, mailboxes: 20, prospects: '~5,500/mo', price: '~$101/mo' },
]

const ACTIVE_STATES: ProvisioningState[] = ['ORDER_PLACED', 'PROVISIONING']
const FAILURE_STATES: ProvisioningState[] = ['ORDER_FAILED', 'PROVISIONING_STALLED']

export default function ProvisioningWizard({
  accountId,
  onClose,
  defaultPrimaryDomain = '',
  defaultUserDetails = {},
}: ProvisioningWizardProps) {
  const { orders, vendors, fetchVendors, suggestDomains, placeOrder, stateLabel } = useProvisioning({ accountId })

  const inFlight = useMemo(
    () => orders.find(o => ACTIVE_STATES.includes(o.state) || o.state === 'PENDING'),
    [orders],
  )
  const latest = orders[0] ?? null

  const [step, setStep] = useState<Step>(inFlight ? 'status' : 'tier')
  const [tier, setTier] = useState<'basic' | 'growth' | 'scale'>('basic')
  const [primaryDomain, setPrimaryDomain] = useState(defaultPrimaryDomain)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedDomain, setSelectedDomain] = useState<string>('')
  const [vendorId, setVendorId] = useState<string>('')
  const [userDetails, setUserDetails] = useState({
    first_name: defaultUserDetails.first_name ?? '',
    last_name:  defaultUserDetails.last_name  ?? '',
    email:      defaultUserDetails.email      ?? '',
    phone:      defaultUserDetails.phone      ?? '',
    address:    defaultUserDetails.address    ?? '',
    city:       defaultUserDetails.city       ?? '',
    country:    defaultUserDetails.country    ?? '',
    postcode:   defaultUserDetails.postcode   ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => { fetchVendors() }, [fetchVendors])
  useEffect(() => {
    if (vendors.length > 0 && !vendorId) setVendorId(vendors[0].id)
  }, [vendors, vendorId])

  useEffect(() => {
    if (inFlight) setStep('status')
  }, [inFlight])

  async function handleSuggest() {
    if (!primaryDomain) return
    setBusy(true)
    setErrMsg(null)
    try {
      const ds = await suggestDomains(primaryDomain)
      setSuggestions(ds)
      if (ds.length > 0 && !selectedDomain) setSelectedDomain(ds[0])
      setStep('pick-domain')
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Failed to load suggestions')
    } finally {
      setBusy(false)
    }
  }

  async function handlePlaceOrder() {
    setBusy(true)
    setErrMsg(null)
    try {
      await placeOrder({
        tier,
        primary_domain: primaryDomain,
        selected_domain: selectedDomain,
        vendor_id: vendorId,
        user_details: userDetails,
      })
      setStep('status')
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Failed to place order')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="provisioning-wizard">
      <header className="provisioning-wizard__header">
        <div>
          <h2>Mailbox provisioning</h2>
          <p className="provisioning-wizard__subtitle">
            Buy a sending domain + warmed mailboxes in one click.
          </p>
        </div>
        {onClose && <button className="provisioning-wizard__close" onClick={onClose} aria-label="Close">×</button>}
      </header>

      <Stepper step={step} disabled={!!inFlight} onJump={(s) => !inFlight && setStep(s)} />

      <div className="provisioning-wizard__body">
        {step === 'tier' && (
          <section className="provisioning-wizard__section">
            <h3>Pick a tier</h3>
            <div className="tier-grid">
              {TIERS.map(t => (
                <button
                  key={t.id}
                  className={`tier-card ${tier === t.id ? 'tier-card--selected' : ''}`}
                  onClick={() => setTier(t.id)}
                >
                  <div className="tier-card__name">{t.name}</div>
                  <div className="tier-card__price">{t.price}</div>
                  <ul className="tier-card__features">
                    <li>{t.domains} domain{t.domains > 1 ? 's' : ''}</li>
                    <li>{t.mailboxes} mailboxes</li>
                    <li>{t.prospects} prospects</li>
                  </ul>
                </button>
              ))}
            </div>
            <FooterNav next={{ label: 'Next', disabled: !tier, onClick: () => setStep('primary-domain') }} />
          </section>
        )}

        {step === 'primary-domain' && (
          <section className="provisioning-wizard__section">
            <h3>What's your real website?</h3>
            <p className="provisioning-wizard__hint">
              We generate sending-domain lookalikes from this, e.g. acme.com → getacme.com, tryacme.com.
            </p>
            <input
              type="text"
              className="provisioning-wizard__input"
              placeholder="acme.com"
              value={primaryDomain}
              onChange={(e) => setPrimaryDomain(e.target.value)}
              autoFocus
            />
            {errMsg && <div className="provisioning-wizard__error">{errMsg}</div>}
            <FooterNav
              back={{ label: 'Back', onClick: () => setStep('tier') }}
              next={{ label: busy ? 'Loading…' : 'Suggest domains', disabled: !primaryDomain || busy, onClick: handleSuggest }}
            />
          </section>
        )}

        {step === 'pick-domain' && (
          <section className="provisioning-wizard__section">
            <h3>Pick a sending domain</h3>
            <p className="provisioning-wizard__hint">
              Real emails will come from this domain. It'll forward to {primaryDomain}.
            </p>
            <div className="domain-grid">
              {suggestions.map(d => (
                <button
                  key={d}
                  className={`domain-card ${selectedDomain === d ? 'domain-card--selected' : ''}`}
                  onClick={() => setSelectedDomain(d)}
                >
                  {d}
                </button>
              ))}
            </div>

            <div className="provisioning-wizard__field">
              <label htmlFor="vendor">Registrar</label>
              <select
                id="vendor"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                disabled={vendors.length === 0}
              >
                {vendors.length === 0 && <option value="">No vendors loaded</option>}
                {vendors.map((v: Vendor) => (
                  <option key={v.id} value={v.id}>{v.name ?? v.id}</option>
                ))}
              </select>
            </div>

            <FooterNav
              back={{ label: 'Back', onClick: () => setStep('primary-domain') }}
              next={{ label: 'Next', disabled: !selectedDomain || !vendorId, onClick: () => setStep('confirm') }}
            />
          </section>
        )}

        {step === 'confirm' && (
          <section className="provisioning-wizard__section">
            <h3>Registrant details</h3>
            <p className="provisioning-wizard__hint">
              Domain registrars require a real contact. This won't be shown to your prospects.
            </p>
            <div className="provisioning-wizard__form">
              <Field label="First name" value={userDetails.first_name} onChange={v => setUserDetails(u => ({ ...u, first_name: v }))} />
              <Field label="Last name"  value={userDetails.last_name}  onChange={v => setUserDetails(u => ({ ...u, last_name: v }))} />
              <Field label="Email"      value={userDetails.email}      onChange={v => setUserDetails(u => ({ ...u, email: v }))} type="email" />
              <Field label="Phone"      value={userDetails.phone}      onChange={v => setUserDetails(u => ({ ...u, phone: v }))} />
              <Field label="Address"    value={userDetails.address}    onChange={v => setUserDetails(u => ({ ...u, address: v }))} />
              <Field label="City"       value={userDetails.city}       onChange={v => setUserDetails(u => ({ ...u, city: v }))} />
              <Field label="Country"    value={userDetails.country}    onChange={v => setUserDetails(u => ({ ...u, country: v }))} />
              <Field label="Postcode"   value={userDetails.postcode}   onChange={v => setUserDetails(u => ({ ...u, postcode: v }))} />
            </div>

            <div className="provisioning-wizard__summary">
              <div><strong>Tier:</strong> {TIERS.find(t => t.id === tier)?.name}</div>
              <div><strong>Sending domain:</strong> {selectedDomain}</div>
              <div><strong>Forwards to:</strong> {primaryDomain}</div>
            </div>

            {errMsg && <div className="provisioning-wizard__error">{errMsg}</div>}

            <FooterNav
              back={{ label: 'Back', onClick: () => setStep('pick-domain') }}
              next={{
                label: busy ? 'Placing order…' : 'Place order',
                disabled: busy || !userDetails.first_name || !userDetails.last_name || !userDetails.email,
                onClick: handlePlaceOrder,
              }}
            />
          </section>
        )}

        {step === 'status' && (
          <section className="provisioning-wizard__section">
            <h3>Order status</h3>
            {inFlight ? (
              <OrderStatusCard order={inFlight} stateLabel={stateLabel} />
            ) : latest ? (
              <OrderStatusCard order={latest} stateLabel={stateLabel} />
            ) : (
              <p>No orders yet.</p>
            )}
            {orders.length > 1 && (
              <details className="provisioning-wizard__history">
                <summary>Past orders ({orders.length - 1})</summary>
                {orders.slice(1).map(o => (
                  <OrderStatusCard key={o.id} order={o} stateLabel={stateLabel} compact />
                ))}
              </details>
            )}
            {!inFlight && (
              <FooterNav next={{ label: 'New order', onClick: () => setStep('tier') }} />
            )}
          </section>
        )}
      </div>
    </div>
  )
}

// ----- helpers -----

function Stepper({ step, disabled, onJump }: { step: Step; disabled: boolean; onJump: (s: Step) => void }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'tier',           label: 'Tier' },
    { id: 'primary-domain', label: 'Site' },
    { id: 'pick-domain',    label: 'Domain' },
    { id: 'confirm',        label: 'Confirm' },
    { id: 'status',         label: 'Status' },
  ]
  const idx = steps.findIndex(s => s.id === step)
  return (
    <ol className="provisioning-wizard__stepper">
      {steps.map((s, i) => (
        <li
          key={s.id}
          className={`provisioning-wizard__stepper-item ${i === idx ? 'is-current' : i < idx ? 'is-done' : ''}`}
          onClick={() => !disabled && i <= idx && onJump(s.id)}
        >
          <span className="provisioning-wizard__stepper-bullet">{i + 1}</span>
          <span className="provisioning-wizard__stepper-label">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}

function FooterNav({ back, next }: { back?: { label: string; onClick: () => void }; next?: { label: string; disabled?: boolean; onClick: () => void } }) {
  return (
    <div className="provisioning-wizard__footer">
      {back ? <button onClick={back.onClick} className="btn btn--ghost">{back.label}</button> : <span />}
      {next && <button onClick={next.onClick} disabled={next.disabled} className="btn btn--primary">{next.label}</button>}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="provisioning-wizard__field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function OrderStatusCard({ order, stateLabel, compact = false }: { order: ProvisioningOrder; stateLabel: (s: ProvisioningState) => string; compact?: boolean }) {
  const failed = FAILURE_STATES.includes(order.state)
  return (
    <div className={`order-status order-status--${order.state.toLowerCase()}${compact ? ' order-status--compact' : ''}`}>
      <div className="order-status__row">
        <span className="order-status__domain">{order.selected_domain ?? '—'}</span>
        <span className="order-status__state">{stateLabel(order.state)}</span>
      </div>
      {!compact && (
        <>
          <div className="order-status__meta">
            <span>{order.num_mailboxes} mailboxes</span>
            <span>·</span>
            <span>Tier: {order.tier ?? '—'}</span>
            {order.warmup_started_at && <><span>·</span><span>Warming since {new Date(order.warmup_started_at).toLocaleDateString()}</span></>}
          </div>
          {failed && order.last_error && (
            <div className="order-status__error">{order.last_error}</div>
          )}
          {!failed && order.state !== 'ACTIVE' && (
            <div className="order-status__progress">
              <div className="order-status__progress-bar" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

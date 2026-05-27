import { useEffect, useRef } from 'react'
import watsonImg from './assets/Watson.png'
import belfortImg from './assets/Belfort.png'
import warrenImg from './assets/Warren.png'
import pepperImg from './assets/Pepper.png'
import draperImg from './assets/Watson.png'
import { useState } from 'react'
import type { Employee } from './types/index'
import supabase from './services/supabase'

import useAuth from './hooks/useAuth'
import useUserDetails from './hooks/useUserDetails'
import useMessages from './hooks/useMessages'
import useMobilisation from './hooks/useMobilisation'
import useBelfort from './hooks/useBelfort'
import useCampaigns from './hooks/useCampaigns'
import useSkillStatus from './hooks/useSkillStatus'
import useWarren from './hooks/useWarren'
import usePepper from './hooks/usePepper'

import Layout from './components/Layout'
import CompanySwitcher from './components/CompanySwitcher'
import EmployeeList from './components/EmployeeList'
import WatsonChat from './components/WatsonChat'
import BelfortTargets from './components/BelfortTargets'
import CampaignManager from './components/CampaignManager'
import TargetDetailSidebar from './components/TargetDetailSidebar'
import RightSidebar from './components/RightSidebar'
import ContactDetailSidebar from './components/ContactDetailSidebar'
import WarrenAnalyst from './components/WarrenAnalyst'
import PepperAdmin from './components/PepperAdmin'
import SuperAdminDashboard from './components/SuperAdminDashboard'
import InviteSignup from './components/InviteSignup'
import InviteLanding from './components/InviteLanding'
import LoginPage from './components/LoginPage'
import type { CampaignContact } from './hooks/useCampaigns'

import './App.css'

const API_URL = import.meta.env.VITE_API_URL
const CLIENT_URL = import.meta.env.VITE_CLIENT_URL

const BASE_EMPLOYEES: Employee[] = [
  { name: 'Watson', role: 'Head of Growth', img: watsonImg },
  { name: 'Belfort', role: 'Lead Generation Expert', img: belfortImg },
  { name: 'Warren', role: 'Business Analyst', img: warrenImg },
  { name: 'Pepper', role: 'Office Administrator', img: pepperImg },
  { name: 'Draper', role: 'Campaign Manager', img: draperImg },
]

export default function App() {
  const [selectedEmployee, setSelectedEmployee] = useState<Employee>(BASE_EMPLOYEES[0])
  const [selectedCampaignContact, setSelectedCampaignContact] = useState<CampaignContact | null>(null)
  // When on an agent tab, lets the user minimise the Watson chat so the agent
  // panel goes full width. Reuses the existing animated `watson-hidden` state.
  const [watsonCollapsed, setWatsonCollapsed] = useState(false)
  const [inviteLanding, setInviteLanding] = useState<{ companyName: string | null; inviterName: string | null } | null>(null)
  // True if we landed with a pending invite token — holds the render until processing completes
  const [inviteProcessing, setInviteProcessing] = useState(() => !!localStorage.getItem('pending_invite_token'))
  const cleanupRef = useRef<(() => void) | null>(null)

  // Fix #10: Cleanup subscription on unmount
  useEffect(() => {
    return () => { cleanupRef.current?.() }
  }, [])
  const [fromClient] = useState(() => {
    // Detect magic link redirect: Supabase puts tokens in the hash fragment
    const hash = window.location.hash
    return hash.includes('access_token') || hash.includes('type=magiclink')
  })

  // Detect invite token in URL and persist it — processed after auth is established
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('invite')
    if (token) {
      localStorage.setItem('pending_invite_token', token)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const { user } = useAuth()
  const ud = useUserDetails({ user })
  const msg = useMessages({ userFirstNameRef: ud.userFirstNameRef, saveMessage: ud.saveMessage })
  const mob = useMobilisation({
    userDetailsId: ud.userDetailsId,
    userDetailsIdRef: ud.userDetailsIdRef,
    accountId: ud.accountId,
    user,
    setMessages: msg.setMessages,
    setIsTyping: msg.setIsTyping,
    showStepMessages: msg.showStepMessages,
    saveMessage: ud.saveMessage,
    onAccountNameChange: ud.updateCompanyName,
  })
  const bel = useBelfort({
    accountId: ud.accountId,
    userDetailsId: ud.userDetailsId,
    selectedEmployee,
    firstname: ud.userFirstNameRef?.current,
  })
  const camp = useCampaigns({
    accountId: ud.accountId,
    userDetailsId: ud.userDetailsId,
    selectedEmployee,
    firstname: ud.userFirstNameRef?.current,
  })
  const { activeSkills, clearActiveSkills } = useSkillStatus({ userDetailsId: ud.userDetailsId })
  const war = useWarren({ accountId: ud.accountId, userDetailsId: ud.userDetailsId, selectedEmployee, firstname: ud.userFirstNameRef?.current })
  const pep = usePepper({ accountId: ud.accountId, userDetailsId: ud.userDetailsId, selectedEmployee, firstname: ud.userFirstNameRef?.current })

  const employees = ud.isSuperAdmin
    ? [...BASE_EMPLOYEES, { name: 'Admin', role: 'Super Admin', img: pepperImg }]
    : BASE_EMPLOYEES

  // Initialise user details + wire up subscriptions once user is loaded
  useEffect(() => {
    if (!user || ud.initialiseRan.current) return
    ud.initialiseRan.current = true
    ;(async () => {
      const details = await ud.initialise()

      // Process pending invite token BEFORE the early-return check.
      // A brand-new invited user has no user_details yet so initialise() returns
      // null — the invite accept is what creates their first user_details record.
      const inviteToken = localStorage.getItem('pending_invite_token')
      if (inviteToken) {
        try {
          const invRes = await fetch(`${API_URL}/api/user/invite/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: inviteToken, auth_id: user.id }),
          })
          if (invRes.ok) {
            localStorage.removeItem('pending_invite_token')
            const invData = await invRes.json()
            setSelectedEmployee(employees[0])
            cleanupRef.current?.()
            msg.setMessages([])
            mob.resetLocalMobilisationState()
            mob.setActiveSidebar(null)
            mob.setSidebarData(() => ({}))
            mob.setInputBarEnabled(false)

            const targetId = invData.user_details_id
            const alreadyLoaded = ud.companiesRef.current.some(c => c.id === targetId)

            if (!alreadyLoaded) {
              const newCompany = {
                id: targetId,
                account_id: invData.account_id,
                account_name: invData.account_name,
                website: invData.website,
                signup_complete: true,
                firstname: invData.firstname ?? (ud.userFirstNameRef.current || null),
                active_mobilisation: null,
                active_step_id: null,
                role: invData.role,
                is_super_admin: false,
              }
              ud.addCompany(newCompany)
            } else {
              await ud.switchCompany(targetId)
            }

            const invCleanup = ud.subscribeToMessages(targetId, {
              setIsTyping: msg.setIsTyping,
              setMessages: msg.setMessages,
              startMobilisation: mob.startMobilisation,
              onCancelled: () => { mob.handleCancelledBroadcast(); clearActiveSkills() },
            })
            cleanupRef.current = invCleanup

            if (!invData.already_member) {
              setInviteLanding({
                companyName: invData.account_name ?? null,
                inviterName: invData.inviter_firstname ?? null,
              })
            } else {
              const msgs = await ud.loadMessages(targetId)
              msg.setMessages(msgs)
              mob.setInputBarEnabled(true)
            }
            setInviteProcessing(false)
            return
          }
          // Non-ok response — let the normal dashboard show
          setInviteProcessing(false)
        } catch (err) {
          console.error('[invite/accept] error:', err)
          setInviteProcessing(false)
        }
      }

      if (!details) return
      const msgs = await ud.loadMessages(details.id)
      msg.setMessages(msgs)
      const cleanup = ud.subscribeToMessages(details.id, {
        setIsTyping: msg.setIsTyping,
        setMessages: msg.setMessages,
        startMobilisation: mob.startMobilisation,
        onCancelled: () => { mob.handleCancelledBroadcast(); clearActiveSkills() },
      })
      cleanupRef.current = cleanup

      if (!details.signup_complete) {
        if (details.active_mobilisation && details.active_step_id) {
          mob.resumeMobilisation(details.active_mobilisation, details.active_step_id, details.id)
        } else {
          mob.startMobilisation('sign_up_get_website')
        }
      } else {
        mob.setInputBarEnabled(true)

        // Welcome back: contextual greeting + state restoration (divider saved server-side)
        if (msgs.length > 0) {
          try {
            const wbRes = await fetch(`${API_URL}/api/messages/welcome-back`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_details_id: details.id }),
            })
            const wb = await wbRes.json()
            if (!wb.skip && wb.restore) {
              if (wb.restore.sidebar) {
                mob.setActiveSidebar(wb.restore.sidebar)
                mob.setSidebarData(() => wb.restore.sidebar_info ?? {})
              }
              if (wb.restore.mobilisation) {
                mob.resumeMobilisation(wb.restore.mobilisation, wb.restore.step_id, details.id)
              }
            }
          } catch (err) {
            console.error('[welcome-back] error:', err)
          }
        }
      }
    })()
  }, [user])

  // Load ITPs when sidebar opens
  useEffect(() => {
    if ((mob.activeSidebar === 'select_itp' || mob.activeSidebar === 'select_campaign_itp') && ud.accountId) {
      mob.loadItpList()
    }
  }, [mob.activeSidebar])

  // Track previous message count to detect genuinely new messages
  const prevMessageCount = useRef(0)

  // Check for latest sidebar-bearing message (only on NEW messages, not initial load)
  useEffect(() => {
    const isNewMessage = msg.messages.length > prevMessageCount.current
    prevMessageCount.current = msg.messages.length

    if (!isNewMessage) return

    const latest = msg.messages[msg.messages.length - 1]
    if (latest?.sidebar) {
      mob.setActiveSidebar(latest.sidebar)
      mob.setSidebarData(() => latest.sidebar_info ?? {})
    }
    if (latest?.navigate_to) {
      const target = employees.find(e => e.name === latest.navigate_to)
      if (target) setSelectedEmployee(target)
    }
    if (latest?.is_agent && !mob.mobilisation_active) {
      mob.setInputBarEnabled(true)
    }
  }, [msg.messages])

  // Watson tab: check queued mobilisations
  useEffect(() => {
    if (selectedEmployee.name === 'Watson') {
      if (ud.userDetailsId && !mob.mobilisation_active && !mob.queueChecked) {
        mob.setQueueChecked(true)
        mob.checkQueuedMobilisations()
      }
    }
    if (selectedEmployee.name !== 'Watson') mob.setQueueChecked(false)
  }, [selectedEmployee, mob.mobilisation_active, ud.userDetailsId])

  async function handleApprovalComplete(approved: number, rejected: number, hasReasons: boolean) {
    mob.setActiveSidebar(null)

    // Insert a brief user-side summary so the chat isn't a wall of Watson messages
    const summaryParts = []
    if (approved > 0) summaryParts.push(`${approved} approved`)
    if (rejected > 0) summaryParts.push(`${rejected} rejected`)
    const summaryText = summaryParts.length > 0 ? `Targets reviewed: ${summaryParts.join(', ')}` : 'Targets reviewed'
    msg.setMessages(prev => [...prev, { message_body: summaryText, is_agent: false, timestamp: new Date() }])

    // Check total approved across all rounds
    const { data: allLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('itp_id', mob.sidebarData.itp_id)
      .eq('approved', true)

    const totalApproved = allLeads?.length ?? 0

    if (totalApproved >= 10) {
      // ITP is validated — trigger campaign creation
      mob.startMobilisation('ten_approved_leads_found')
    } else if (rejected > 0 && hasReasons) {
      // Need to refine ITP and find more
      fetch(`${API_URL}/api/skills/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee: 'lead_gen_expert',
          skill: 'itp_refiner',
          user_details_id: ud.userDetailsId,
          inputs: { itp_id: mob.sidebarData.itp_id },
        }),
      }).catch(err => console.error('itp_refiner dispatch error:', err))
    } else {
      // Rejections without reasons — just find more
      fetch(`${API_URL}/api/skills/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee: 'lead_gen_expert',
          skill: 'target_finder_ten_leads',
          user_details_id: ud.userDetailsId,
          inputs: { itp_id: mob.sidebarData.itp_id },
        }),
      }).catch(err => console.error('target_finder dispatch error:', err))
    }
  }

  async function handleTemplateApprove(updatedSequence: any[]) {
    const campaignId = mob.sidebarData.campaign_id
    const firstEmail = updatedSequence[0] ?? {}
    await supabase
      .from('campaigns')
      .update({
        subject_line: firstEmail.subject ?? '',
        email_template: firstEmail.body ?? '',
        email_sequence: updatedSequence,
      })
      .eq('id', campaignId)

    mob.setActiveSidebar(null)
    await mob.startMobilisation('review_campaign')
    // Set campaign_id AFTER startMobilisation (which clears responses)
    mob.mobilisationResponsesRef.current = { ...mob.mobilisationResponsesRef.current, campaign_id: campaignId }
    mob.setMobilisationResponses((prev: Record<string, string>) => ({ ...prev, campaign_id: campaignId }))
  }

  async function handleSenderSelect(senderId: string) {
    const campaignId = mob.mobilisationResponsesRef.current.campaign_id
    if (campaignId) {
      // Campaign flow: save sender_id to campaign and advance mobilisation
      await supabase.from('campaigns').update({ sender_id: senderId }).eq('id', campaignId)
      mob.mobilisationResponsesRef.current = { ...mob.mobilisationResponsesRef.current, sender_id: senderId }
      mob.setMobilisationResponses((prev: Record<string, string>) => ({ ...prev, sender_id: senderId }))
      mob.handleSidebarAdvance('Sender selected')
    } else {
      // Pepper page: just close sidebar and refresh senders list
      mob.setActiveSidebar(null)
      pep.refreshSenders()
    }
  }

  async function handleSwitchCompany(targetId: string) {
    if (targetId === ud.userDetailsId) return

    // Navigate to Watson so the user sees the chat for the new company
    setSelectedEmployee(employees[0])

    // Tear down current subscription
    cleanupRef.current?.()
    cleanupRef.current = null

    // Reset local state only — don't wipe DB progress so mid-signup companies can resume
    msg.setMessages([])
    msg.setIsTyping(false)
    mob.resetLocalMobilisationState()
    mob.setActiveSidebar(null)
    mob.setSidebarData(() => ({}))
    mob.setInputBarEnabled(false)

    // Switch active company — fetches fresh data so signup_complete is never stale
    const details = await ud.switchCompany(targetId)
    if (!details) return

    // Load messages and subscribe for new company
    const msgs = await ud.loadMessages(details.id)
    msg.setMessages(msgs)
    const cleanup = ud.subscribeToMessages(details.id, {
      setIsTyping: msg.setIsTyping,
      setMessages: msg.setMessages,
      startMobilisation: mob.startMobilisation,
      onCancelled: () => { mob.handleCancelledBroadcast(); clearActiveSkills() },
    })
    cleanupRef.current = cleanup

    // Resume or start mobilisation for new company
    if (!details.signup_complete) {
      if (details.active_mobilisation && details.active_step_id) {
        mob.resumeMobilisation(details.active_mobilisation, details.active_step_id, details.id)
      } else {
        mob.startMobilisation('sign_up_get_website', { startStep: 'welcome_returning' })
      }
    } else {
      mob.setInputBarEnabled(true)
      if (msgs.length > 0) {
        try {
          const wbRes = await fetch(`${API_URL}/api/messages/welcome-back`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_details_id: details.id }),
          })
          const wb = await wbRes.json()
          if (!wb.skip && wb.restore) {
            if (wb.restore.sidebar) {
              mob.setActiveSidebar(wb.restore.sidebar)
              mob.setSidebarData(() => wb.restore.sidebar_info ?? {})
            }
            if (wb.restore.mobilisation) {
              mob.resumeMobilisation(wb.restore.mobilisation, wb.restore.step_id, details.id)
            }
          }
        } catch (err) {
          console.error('[welcome-back] error:', err)
        }
      }
    }
  }

  async function handleAddCompany() {
    if (!user) return

    const res = await fetch(`${API_URL}/api/user/companies/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_id: user.id,
        firstname: ud.userFirstNameRef.current || null,
      }),
    })
    if (!res.ok) return
    const { company } = await res.json()

    // Navigate to Watson for the new company's chat
    setSelectedEmployee(employees[0])

    // Tear down current subscription
    cleanupRef.current?.()
    cleanupRef.current = null

    // Reset local state only
    msg.setMessages([])
    msg.setIsTyping(false)
    mob.resetLocalMobilisationState()
    mob.setActiveSidebar(null)
    mob.setSidebarData(() => ({}))
    mob.setInputBarEnabled(false)

    // Add and activate the new company — updates userDetailsIdRef immediately
    ud.addCompany({
      id: company.id,
      account_id: company.account_id,
      account_name: null,
      website: null,
      signup_complete: false,
      firstname: ud.userFirstNameRef.current || null,
      active_mobilisation: null,
      active_step_id: null,
      role: 'admin',
      is_super_admin: false,
    })

    // Subscribe to new company's realtime channel
    const cleanup = ud.subscribeToMessages(company.id, {
      setIsTyping: msg.setIsTyping,
      setMessages: msg.setMessages,
      startMobilisation: mob.startMobilisation,
      onCancelled: () => { mob.handleCancelledBroadcast(); clearActiveSkills() },
    })
    cleanupRef.current = cleanup

    // Start the signup flow with the returning welcome message
    await mob.startMobilisation('sign_up_get_website', { startStep: 'welcome_returning' })
  }

  async function handleDeleteCompany() {
    if (!user || !ud.userDetailsId) return
    const res = await fetch(`${API_URL}/api/user/companies/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_details_id: ud.userDetailsId, auth_id: user.id }),
    })
    if (!res.ok) return

    // Remove from companies list and switch to the next available company
    const remaining = ud.companies.filter(c => c.id !== ud.userDetailsId)
    if (remaining.length === 0) return
    ud.setCompanies(remaining)
    await handleSwitchCompany(remaining[0].id)
  }

  async function handleInviteEnter() {
    setInviteLanding(null)
    await mob.startMobilisation('invited_member_welcome')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (user === undefined) return null
  if (user === null) {
    const pendingToken = localStorage.getItem('pending_invite_token')
    if (pendingToken) return <InviteSignup token={pendingToken} />
    return <LoginPage />
  }
  if (inviteProcessing) return null
  if (inviteLanding) {
    return <InviteLanding
      companyName={inviteLanding.companyName}
      inviterName={inviteLanding.inviterName}
      onEnter={handleInviteEnter}
    />
  }

  return (
    <Layout
      onLogout={handleLogout}
      companySwitcher={
        ud.companies.length > 0 ? (
          <CompanySwitcher
            companies={ud.companies}
            activeId={ud.userDetailsId}
            onSwitch={handleSwitchCompany}
            onAddCompany={handleAddCompany}
          />
        ) : undefined
      }
      employeeList={
        <EmployeeList
          employees={employees}
          selectedEmployee={selectedEmployee}
          onSelect={setSelectedEmployee}
          activeSkills={activeSkills}
        />
      }
    >
      {(<>
        {/* Employee panel — visible when not on Watson */}
        <div id="employee-panel" className={selectedEmployee.name === 'Watson' ? 'panel-hidden' : 'panel-visible'}>
          <div className="dashboard-topbar">
            <div className="topbar-agent-status">
              <span className="topbar-agent-icon">◆</span>
              <span className="topbar-agent-name">{selectedEmployee.name}</span>
              <span className="topbar-active-dot">● Active</span>
            </div>
            {watsonCollapsed && (
              <button className="watson-reopen-btn" onClick={() => setWatsonCollapsed(false)}>
                ‹ Show Watson
              </button>
            )}
          </div>
          {selectedEmployee.name === 'Belfort' && (
            <BelfortTargets
              belfortItps={bel.belfortItps}
              belfortSelectedItpId={bel.belfortSelectedItpId}
              belfortSubTab={bel.belfortSubTab}
              selectedLead={bel.selectedLead}
              onSelectItp={(id) => { bel.setBelfortSelectedItpId(id); bel.setExpandedLeadId(null) }}
              onSelectSubTab={(tab) => { bel.setBelfortSubTab(tab as 'needs_approval' | 'approved'); bel.setSelectedLead(null) }}
              onSelectLead={bel.setSelectedLead}
              loading={bel.loading}
              needsApprovalDisplay={bel.needsApprovalDisplay}
              needsApprovalTotal={bel.needsApprovalTotal}
              approvedLeads={bel.approvedLeads}
              approvedPage={bel.approvedPage}
              approvedPageCount={bel.approvedPageCount}
              approvedTotal={bel.approvedTotal}
              approvedLoading={bel.approvedLoading}
              onApprovedPageChange={bel.setApprovedPage}
              rejectedLeads={bel.rejectedLeads}
              rejectedPage={bel.rejectedPage}
              rejectedPageCount={bel.rejectedPageCount}
              rejectedTotal={bel.rejectedTotal}
              rejectedLoading={bel.rejectedLoading}
              onRejectedPageChange={bel.setRejectedPage}
              autoApproveLeads={bel.autoApproveLeads}
              onToggleAutoApprove={bel.toggleAutoApprove}
              belfortSummary={bel.belfortSummary}
              pendingRefinementCount={bel.pendingRefinementCount}
              refining={bel.refining}
              onRefineItp={bel.refineItp}
            />
          )}
          {selectedEmployee.name === 'Draper' && (
            <CampaignManager
              campaigns={camp.campaigns}
              selectedCampaign={camp.selectedCampaign}
              onSelectCampaign={camp.setSelectedCampaign}
              campaignContacts={camp.campaignContacts}
              campaignItp={camp.campaignItp}
              selectedContact={selectedCampaignContact}
              onSelectContact={setSelectedCampaignContact}
              draperSummary={camp.draperSummary}
              contactsLoading={camp.contactsLoading}
              campaignSenders={camp.campaignSenders}
              allSenders={camp.allSenders}
              onChangeSender={camp.changeCampaignSender}
              onToggleStatus={camp.toggleCampaignStatus}
              onUpdateCampaign={camp.updateCampaign}
              hasMoreContacts={camp.hasMoreContacts}
              onLoadMoreContacts={camp.loadMoreContacts}
              onRefresh={camp.refreshCampaigns}
            />
          )}
          {selectedEmployee.name === 'Warren' && (
            <WarrenAnalyst
              itps={war.itps}
              itpStats={war.itpStats}
              account={war.account}
              customers={war.customers}
              onUpdateAccount={war.updateAccount}
              onUpdateItp={war.updateItp}
              warrenSummary={war.warrenSummary}
            />
          )}
          {selectedEmployee.name === 'Pepper' && (
            <PepperAdmin
              account={pep.account}
              userDetails={pep.userDetails}
              activityLog={pep.activityLog}
              senders={pep.senders}
              onUpdateUserFirstname={pep.updateUserFirstname}
              onUpdateSender={pep.updateSender}
              onAddSender={() => mob.setActiveSidebar('select_sender')}
              onDeleteCompany={handleDeleteCompany}
              canDeleteCompany={ud.companies.length > 1 && ud.role === 'admin'}
              isAdmin={ud.role === 'admin'}
              userDetailsId={ud.userDetailsId}
              pepperSummary={pep.pepperSummary}
            />
          )}
          {selectedEmployee.name === 'Admin' && ud.isSuperAdmin && (
            <SuperAdminDashboard userDetailsId={ud.userDetailsId} />
          )}
        </div>

        {/* Watson chat — always rendered, transitions between full and sidebar */}
        <div id="watson-panel" className={`${selectedEmployee.name === 'Watson' ? 'watson-full' : (selectedEmployee.name === 'Admin' || mob.activeSidebar || bel.selectedLead || selectedCampaignContact || watsonCollapsed) ? 'watson-hidden' : 'watson-sidebar'}${fromClient ? ' from-client' : ''}${camp.selectedCampaign ? ' watson-narrow' : ''}`}>
          {selectedEmployee.name !== 'Watson' && (
            <div className="watson-sidebar-header">
              <div className="topbar-agent-status">
                <span className="topbar-agent-icon">◆</span>
                <span className="topbar-agent-name">Watson</span>
                <span className="topbar-active-dot">● Active</span>
              </div>
              <button
                className="watson-collapse-btn"
                onClick={() => setWatsonCollapsed(true)}
                title="Hide Watson"
              >
                Hide ›
              </button>
            </div>
          )}
          {selectedEmployee.name === 'Watson' && (
            <div className="dashboard-topbar">
              <div className="topbar-agent-status">
                <span className="topbar-agent-icon">◆</span>
                <span className="topbar-agent-name">Watson</span>
                <span className="topbar-active-dot">● Active</span>
              </div>
            </div>
          )}
          <WatsonChat
            messages={msg.messages}
            options={mob.options}
            isTyping={msg.isTyping}
            input_bar_enabled={mob.input_bar_enabled}
            activeSidebar={mob.activeSidebar}
            activeSkills={activeSkills}
            messagesEndRef={msg.messagesEndRef}
            inputRef={mob.inputRef}
            onOptionSelect={mob.handleOptionSelect}
            onSend={mob.handleSend}
            onKeyDown={mob.handleKeyDown}
            formatTime={msg.formatTime}
            compact={selectedEmployee.name !== 'Watson'}
            canStop={mob.mobilisation_active || activeSkills.length > 0}
            onStop={() => { clearActiveSkills(); mob.cancelAll() }}
          />
        </div>
      </>)}

      {bel.selectedLead && (
        <TargetDetailSidebar
          lead={bel.selectedLead}
          onClose={() => bel.setSelectedLead(null)}
          onApprove={bel.approveLead}
          onReject={(lead, reason) => {
            if (lead.approved) {
              bel.rejectApprovedLead(lead, reason ?? '')
            } else {
              bel.rejectLead({ ...lead, rejection_reason: reason })
            }
          }}
        />
      )}

      {selectedCampaignContact && (
        <ContactDetailSidebar
          contact={selectedCampaignContact}
          onClose={() => setSelectedCampaignContact(null)}
        />
      )}

      {mob.activeSidebar && (
        <RightSidebar
          activeSidebar={mob.activeSidebar}
          sidebarData={mob.sidebarData}
          setSidebarData={mob.setSidebarData}
          onSaveCompanyDetails={mob.handleSaveCompanyDetails}
          onSidebarAdvance={mob.handleSidebarAdvance}
          onSaveItp={mob.handleSaveItp}
          itpList={mob.itpList}
          selectedItpId={mob.selectedItpId}
          setSelectedItpId={mob.setSelectedItpId}
          manualCustomers={mob.manualCustomers}
          manualCustomerInput={mob.manualCustomerInput}
          setManualCustomerInput={mob.setManualCustomerInput}
          onAddManualCustomer={mob.handleAddManualCustomer}
          csvRows={mob.csvRows}
          csvError={mob.csvError}
          csvDragOver={mob.csvDragOver}
          setCsvDragOver={mob.setCsvDragOver}
          onCsvDrop={mob.handleCsvDrop}
          onDownloadCsvTemplate={mob.downloadCsvTemplate}
          userDetailsId={ud.userDetailsId}
          API_URL={API_URL}
          onApprovalComplete={handleApprovalComplete}
          accountId={ud.accountId}
          onTemplateApprove={handleTemplateApprove}
          onSenderSelect={handleSenderSelect}

          onClose={() => mob.setActiveSidebar(null)}
          narrow={!!camp.selectedCampaign}
        />
      )}
    </Layout>
  )
}

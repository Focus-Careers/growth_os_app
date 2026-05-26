import { useState, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import supabase from '../services/supabase'
import type { User } from '@supabase/supabase-js'
import type { Message, MobilisationStep, StepOption, CustomerInput } from '../types/index'

const API_URL = import.meta.env.VITE_API_URL

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface UseMobilisationParams {
  userDetailsId: string | null
  userDetailsIdRef: React.MutableRefObject<string | null>
  accountId: string | null
  user: User | null | undefined
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setIsTyping: (v: boolean) => void
  showStepMessages: (step: { messages: string[] }) => Promise<Message[]>
  saveMessage: (message_body: string, is_agent: boolean, triggerProcessor?: boolean) => Promise<Message | null>
  onAccountNameChange?: (accountId: string, name: string) => void
}

/**
 * Manages the full mobilisation flow: starting, resuming, stepping,
 * completing mobilisations, handling options, sidebars, manual customers, CSV uploads.
 */
export default function useMobilisation({
  userDetailsId,
  userDetailsIdRef,
  accountId,
  user,
  setMessages,
  setIsTyping,
  showStepMessages,
  saveMessage,
  onAccountNameChange,
}: UseMobilisationParams) {

  const [mobilisation_active, setMobilisationActive] = useState(false)
  const [current_mobilisation, setCurrentMobilisation] = useState<string | null>(null)
  const [current_step, setCurrentStep] = useState<MobilisationStep | null>(null)
  const [mobilisation_responses, _setMobilisationResponses] = useState<Record<string, string>>({})
  const mobilisationResponsesRef = useRef<Record<string, string>>({})

  // Wrapper that keeps both state and ref in sync
  const setMobilisationResponses = useCallback((update: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
    _setMobilisationResponses(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      mobilisationResponsesRef.current = next
      return next
    })
  }, [])
  const [input_bar_enabled, setInputBarEnabled] = useState(false)
  const [inputValue, _setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const setInputValue = useCallback((val: string) => {
    _setInputValue(val)
    if (inputRef.current) inputRef.current.value = val
  }, [])
  const [options, setOptions] = useState<StepOption[] | null>(null)

  // Sidebar state
  const [activeSidebar, setActiveSidebar] = useState<string | null>(null)
  const [sidebarData, setSidebarData] = useState<Record<string, any>>({})
  const [sidebarNextId, setSidebarNextId] = useState<string | null>(null)

  // Customer input state (used by sidebar panels)
  const [manualCustomers, setManualCustomers] = useState<CustomerInput[]>([])
  const [manualCustomerInput, setManualCustomerInput] = useState<CustomerInput>({ organisation_name: '', organisation_website: '' })
  const [csvRows, setCsvRows] = useState<CustomerInput[]>([])
  const [csvDragOver, setCsvDragOver] = useState(false)
  const [csvError, setCsvError] = useState<string | null>(null)

  // ITP selection sidebar state
  const [itpList, setItpList] = useState<any[]>([])
  const [selectedItpId, setSelectedItpId] = useState<string | null>(null)

  // Queue check state
  const [queueChecked, setQueueChecked] = useState(false)


  // ── Persistence helpers ──────────────────────────────────────────────

  const saveMobilisationState = useCallback(async (mobilisation: string, stepId: string) => {
    if (!userDetailsId) return
    await supabase
      .from('user_details')
      .update({ active_mobilisation: mobilisation, active_step_id: stepId })
      .eq('id', userDetailsId)
  }, [userDetailsId])

  // Resets only local React state — used on company switch to avoid wiping DB progress
  const resetLocalMobilisationState = useCallback(() => {
    setMobilisationActive(false)
    setCurrentMobilisation(null)
    setCurrentStep(null)
    setOptions(null)
    setQueueChecked(false)
  }, [])

  // Resets local state AND clears DB — used when a mobilisation actually completes/ends
  const clearMobilisationState = useCallback(async () => {
    setMobilisationActive(false)
    setCurrentMobilisation(null)
    setCurrentStep(null)
    setOptions(null)
    setQueueChecked(false) // Reset so queue is re-checked after every mobilisation ends
    if (!userDetailsId) return
    await supabase
      .from('user_details')
      .update({ active_mobilisation: null, active_step_id: null })
      .eq('id', userDetailsId)
  }, [userDetailsId])

  // ── Mobilisation completion ──────────────────────────────────────────

  const completeMobilisation = useCallback(async (
    mobilisationName: string,
    responses: Record<string, string>,
    msgs: Message[] = [],
  ) => {
    const res = await fetch(`${API_URL}/api/mobilisation/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobilisation: mobilisationName, responses, messages: msgs, user_details_id: userDetailsId }),
    })
    const { result } = await res.json()
    return result
  }, [userDetailsId])

  // ── Start mobilisation ───────────────────────────────────────────────

  const startMobilisation = useCallback(async (name: string, options?: { startStep?: string }) => {
    // Use ref so we always act on the current userDetailsId, even when called
    // immediately after a company switch before React re-renders.
    const currentUdId = userDetailsIdRef.current
    setMobilisationResponses({})
    setInputBarEnabled(false)
    // Clear this mobilisation from the DB queue if it was queued as a safety net.
    // Prevents double-firing if the broadcast already triggered it and the user
    // later reconnects or navigates back to the Watson tab.
    if (currentUdId) {
      const { data: ud } = await supabase.from('user_details').select('queued_mobilisations').eq('id', currentUdId).single()
      const queue: { mobilisation: string }[] = ud?.queued_mobilisations ?? []
      if (queue.some(q => q.mobilisation === name)) {
        await supabase.from('user_details').update({
          queued_mobilisations: queue.filter(q => q.mobilisation !== name),
        }).eq('id', currentUdId)
      }
    }
    try {
      const res = await fetch(`${API_URL}/api/mobilisation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobilisation: name, user_details_id: currentUdId, start_step: options?.startStep ?? null }),
      })
      const result = await res.json()
      if (result.step) {
        setMobilisationActive(true)
        setCurrentMobilisation(name)
        setCurrentStep(result.step)
        if (currentUdId) {
          await supabase.from('user_details').update({ active_mobilisation: name, active_step_id: result.step.id }).eq('id', currentUdId)
        }
        const addedMessages = await showStepMessages(result.step)
        if (result.step.type === 'end_flow') {
          setMobilisationActive(false)
          setCurrentMobilisation(null)
          setCurrentStep(null)
          setOptions(null)
          if (currentUdId) {
            await supabase.from('user_details').update({ active_mobilisation: null, active_step_id: null }).eq('id', currentUdId)
          }
          const completion = await completeMobilisation(name, {}, addedMessages)
          if (completion?.next_mobilisation) {
            // Recursive call — startMobilisation will handle the next one
            await startMobilisation(completion.next_mobilisation)
          } else {
            setInputBarEnabled(true)
          }
        } else if (result.step.type === 'sidebar') {
          setActiveSidebar(result.step.sidebar)
          setSidebarNextId(result.step.next_id)
          setSidebarData({})
        } else if (result.step.type === 'option_set' || result.step.type === 'ai_message_with_options') {
          setOptions(result.step.options)
        } else if (result.step.type === 'option_set_with_input') {
          setOptions(result.step.options)
          setInputBarEnabled(true)
        } else {
          setInputBarEnabled(true)
        }
      }
    } catch (err) {
      console.error('mobilisation start error:', err)
      setMessages(prev => [...prev, {
        message_body: "Sorry — I hit a snag getting that started. Want to try again, or shall we do something else?",
        is_agent: true,
        timestamp: new Date(),
      }])
      setInputBarEnabled(true)
    }
  }, [showStepMessages, completeMobilisation])

  // ── Resume mobilisation ──────────────────────────────────────────────

  const resumeMobilisation = useCallback(async (mobilisationName: string, stepId: string, _detailsId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/mobilisation/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobilisation: mobilisationName, step_id: stepId, value: null }),
      })
      const result = await res.json()
      if (result.step) {
        setMobilisationActive(true)
        setCurrentMobilisation(mobilisationName)
        setCurrentStep(result.step)
        if (result.step.type === 'option_set' || result.step.type === 'ai_message_with_options') {
          setOptions(result.step.options)
        } else if (result.step.type === 'option_set_with_input') {
          setOptions(result.step.options)
          setInputBarEnabled(true)
        } else if (result.step.type !== 'end_flow') {
          setInputBarEnabled(true)
        }
      }
    } catch (err) {
      console.error('mobilisation resume error:', err)
      startMobilisation('sign_up_get_website')
    }
  }, [startMobilisation])

  // ── Check queued mobilisations ───────────────────────────────────────

  const checkQueuedMobilisations = useCallback(async () => {
    if (!userDetailsId) return
    const { data: ud, error } = await supabase
      .from('user_details')
      .select('queued_mobilisations, active_mobilisation')
      .eq('id', userDetailsId)
      .single()
    console.log('[queue] checkQueuedMobilisations:', ud, error)
    if (ud?.active_mobilisation || !ud?.queued_mobilisations?.length) return
    const [next, ...remaining] = ud.queued_mobilisations
    await supabase.from('user_details').update({ queued_mobilisations: remaining }).eq('id', userDetailsId)
    setIsTyping(true)
    await delay(1500)
    setIsTyping(false)
    await startMobilisation(next.mobilisation)
  }, [userDetailsId, setIsTyping, startMobilisation])

  // ── Handle send (free-type input) ────────────────────────────────────

  // Fix #4: Prevent send spam
  const sendingRef = useRef(false)

  const handleSend = useCallback(async () => {
    const text = (inputRef.current?.value ?? '').trim()
    if (!text || !input_bar_enabled || activeSidebar || sendingRef.current) return
    sendingRef.current = true

    try {
    // Check if user wants to cancel the current mobilisation
    const cancelPhrases = ['cancel', 'stop', 'never mind', 'nevermind', 'quit', 'exit', 'go back', 'forget it']
    if (mobilisation_active && cancelPhrases.some(p => text.toLowerCase().includes(p))) {
      const tempId = `temp_${Date.now()}_${Math.random()}`
      setMessages(prev => [...prev, { tempId, message_body: text, is_agent: false, timestamp: new Date() }])
      setInputValue('')
      saveMessage(text, false, false)
      await clearMobilisationState()
      setMessages(prev => [...prev, {
        message_body: "No problem — I've cancelled that. What would you like to do instead?",
        is_agent: true,
        timestamp: new Date(),
      }])
      setInputBarEnabled(true)
      return
    }

    const tempId = `temp_${Date.now()}_${Math.random()}`
    setMessages(prev => [...prev, { tempId, message_body: text, is_agent: false, timestamp: new Date() }])
    setInputValue('')
    setInputBarEnabled(false)
    saveMessage(text, false, !mobilisation_active).then(saved => {
      if (saved) setMessages(prev => prev.map(m => m.tempId === tempId ? saved : m))
    })

    if (mobilisation_active && current_step?.next_id) {
      const responseKey = current_step.response_key ?? current_step.id
      const updatedResponses = { ...mobilisationResponsesRef.current, [responseKey]: text }
      setMobilisationResponses(updatedResponses)

      try {
        const res = await fetch(`${API_URL}/api/mobilisation/step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mobilisation: current_mobilisation, step_id: current_step.next_id, value: text, user_details_id: userDetailsId }),
        })
        const result = await res.json()
        if (result.step) {
          setCurrentStep(result.step)
          if (result.step.type === 'end_flow') {
            const finishingMobilisation = current_mobilisation!
            await clearMobilisationState()
            const addedMessages = await showStepMessages(result.step)
            await completeMobilisation(finishingMobilisation, updatedResponses, addedMessages)

            // If we came from an option_set_with_input, trigger processor for the typed message
            if (current_step?.type === 'option_set_with_input') {
              fetch(`${API_URL}/api/messages/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ record: { user_details_id: userDetailsId, is_agent: false }, type: 'INSERT' }),
              }).catch(err => console.error('[handleSend] processor trigger after option_set_with_input:', err))
            }

            setInputBarEnabled(true)
          } else {
            await saveMobilisationState(current_mobilisation!, result.step.id)
            await showStepMessages(result.step)
            if (result.step.type === 'option_set' || result.step.type === 'ai_message_with_options') {
              setOptions(result.step.options)
            } else if (result.step.type === 'option_set_with_input') {
              setOptions(result.step.options)
              setInputBarEnabled(true)
            } else {
              setInputBarEnabled(true)
            }
          }
        }
      } catch (err) {
        console.error('mobilisation step error:', err)
        setMessages(prev => [...prev, {
          message_body: "Sorry — something went wrong there. Want to try that again, or is there something else I can help with?",
          is_agent: true,
          timestamp: new Date(),
        }])
        setInputBarEnabled(true)
      }
    }
    } finally { sendingRef.current = false }
  }, [
    input_bar_enabled, activeSidebar, mobilisation_active, current_step,
    current_mobilisation, mobilisation_responses, userDetailsId,
    setMessages, saveMessage, showStepMessages, saveMobilisationState,
    clearMobilisationState, completeMobilisation,
  ])

  // ── Handle option select ─────────────────────────────────────────────

  const optionProcessingRef = useRef(false)

  const handleOptionSelect = useCallback(async (option: StepOption) => {
    if (activeSidebar || optionProcessingRef.current) return
    optionProcessingRef.current = true
    setOptions(null)

    if (mobilisation_active && current_mobilisation) {
      await saveMobilisationState(current_mobilisation, current_step?.id ?? '')
    }

    const tempId = `temp_${Date.now()}_${Math.random()}`
    setMessages(prev => [...prev, { tempId, message_body: option.message, is_agent: false, timestamp: new Date() }])
    saveMessage(option.message, false, false).then(saved => {
      if (saved) setMessages(prev => prev.map(m => m.tempId === tempId ? saved : m))
    })

    // Store response for this step (use ref for latest value across async boundaries)
    const responseKey = current_step?.response_key ?? current_step?.id
    const updatedResponses = responseKey
      ? { ...mobilisationResponsesRef.current, [responseKey]: option.message }
      : { ...mobilisationResponsesRef.current }
    setMobilisationResponses(updatedResponses)

    if (!option.next_id && !current_step?.next_id) {
      console.warn('No next_id on current_step or option — returning early')
      return
    }

    try {
      const res = await fetch(`${API_URL}/api/mobilisation/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobilisation: current_mobilisation, step_id: option.next_id ?? current_step!.next_id, value: option.message, user_details_id: userDetailsId }),
      })
      const result = await res.json()
      if (result.step) {
        setCurrentStep(result.step)
        if (result.step.type === 'sidebar') {
          await showStepMessages(result.step)
          setActiveSidebar(result.step.sidebar)
          setSidebarNextId(result.step.next_id)
          setSidebarData({})
          setManualCustomers([])
          setCsvRows([])
        } else if (result.step.type === 'end_flow') {
          const finishingMobilisation = current_mobilisation!
          await clearMobilisationState()
          const addedMessages = await showStepMessages(result.step)
          const completion = await completeMobilisation(finishingMobilisation, updatedResponses, addedMessages)
          if (completion?.next_mobilisation) {
            await startMobilisation(completion.next_mobilisation)
          } else {
            setInputBarEnabled(true)
          }
        } else {
          await saveMobilisationState(current_mobilisation!, result.step.id)
          await showStepMessages(result.step)
          if (result.step.type === 'option_set' || result.step.type === 'ai_message_with_options') {
            setOptions(result.step.options)
          } else if (result.step.type === 'option_set_with_input') {
            setOptions(result.step.options)
            setInputBarEnabled(true)
          } else {
            setInputBarEnabled(true)
          }
        }
      }
    } catch (err) {
      console.error('option select error:', err)
      setMessages(prev => [...prev, {
        message_body: "Sorry — something went wrong processing that. Want to try again?",
        is_agent: true,
        timestamp: new Date(),
      }])
      setInputBarEnabled(true)
    } finally {
      optionProcessingRef.current = false
    }
  }, [
    activeSidebar, current_step, current_mobilisation, mobilisation_active,
    mobilisation_responses, userDetailsId,
    setMessages, saveMessage, showStepMessages,
    saveMobilisationState, clearMobilisationState, completeMobilisation, startMobilisation,
  ])

  // ── Sidebar advance (generic) ────────────────────────────────────────

  const handleSidebarAdvance = useCallback(async (messageText?: string) => {
    if (messageText) {
      const tempId = `temp_${Date.now()}_${Math.random()}`
      setMessages(prev => [...prev, { tempId, message_body: messageText, is_agent: false, timestamp: new Date() }])
      const saved = await saveMessage(messageText, false, false)
      if (saved) setMessages(prev => prev.map(m => m.tempId === tempId ? saved : m))
    }
    // Store selected ITP ID in responses if an ITP sidebar was active
    let currentResponses = mobilisation_responses
    if ((activeSidebar === 'select_campaign_itp' || activeSidebar === 'select_itp') && selectedItpId) {
      currentResponses = { ...mobilisationResponsesRef.current, itp_id: selectedItpId }
      setMobilisationResponses(currentResponses)
    }
    setActiveSidebar(null)
    if (!sidebarNextId) return
    try {
      const res = await fetch(`${API_URL}/api/mobilisation/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobilisation: current_mobilisation, step_id: sidebarNextId, value: null, user_details_id: userDetailsId }),
      })
      const result = await res.json()
      if (result.step) {
        setCurrentStep(result.step)
        if (result.step.type === 'end_flow') {
          const finishingMobilisation = current_mobilisation!
          await clearMobilisationState()
          const addedMessages = await showStepMessages(result.step)
          await completeMobilisation(finishingMobilisation, currentResponses, addedMessages)
        } else {
          await saveMobilisationState(current_mobilisation!, result.step.id)
          await showStepMessages(result.step)
          if (result.step.type === 'option_set' || result.step.type === 'ai_message_with_options') {
            setOptions(result.step.options)
          } else if (result.step.type === 'option_set_with_input') {
            setOptions(result.step.options)
            setInputBarEnabled(true)
          } else {
            setInputBarEnabled(true)
          }
        }
      }
    } catch (err) {
      console.error('sidebar advance error:', err)
    }
  }, [
    activeSidebar, selectedItpId, sidebarNextId, current_mobilisation, mobilisation_responses, userDetailsId,
    setMessages, saveMessage, showStepMessages,
    saveMobilisationState, clearMobilisationState, completeMobilisation,
  ])

  // ── Save company details sidebar ─────────────────────────────────────

  const handleSaveCompanyDetails = useCallback(async () => {
    if (accountId) {
      await supabase.from('account').update({
        organisation_website: sidebarData.website_url ?? null,
        organisation_name: sidebarData.company_name ?? null,
        description: sidebarData.company_description ?? null,
        problem_solved: sidebarData.problem_solved ?? null,
      }).eq('id', accountId)
      if (sidebarData.company_name) onAccountNameChange?.(accountId, sidebarData.company_name)
    }

    const text = 'Looks good. Save my organisation details.'
    const tempId = `temp_${Date.now()}_${Math.random()}`
    setMessages(prev => [...prev, { tempId, message_body: text, is_agent: false, timestamp: new Date() }])
    saveMessage(text, false, false).then(saved => {
      if (saved) setMessages(prev => prev.map(m => m.tempId === tempId ? saved : m))
    })

    setActiveSidebar(null)
    startMobilisation('upload_customers')
  }, [accountId, sidebarData, setMessages, saveMessage, startMobilisation, onAccountNameChange])

  // ── Save ITP sidebar ─────────────────────────────────────────────────

  const handleSaveItp = useCallback(async () => {
    const itpId = sidebarData.itp_id
    if (itpId) {
      await supabase.from('itp').update({
        name: sidebarData.name ?? null,
        itp_summary: sidebarData.itp_summary ?? null,
        itp_demographic: sidebarData.demographics ?? null,
        itp_pain_points: sidebarData.pain_points ?? null,
        itp_buying_trigger: sidebarData.buying_trigger ?? null,
        location: sidebarData.location ?? null,
      }).eq('id', itpId)
    }
    const text = 'Looks good.'
    const tempId = `temp_${Date.now()}_${Math.random()}`
    setMessages(prev => [...prev, { tempId, message_body: text, is_agent: false, timestamp: new Date() }])
    saveMessage(text, false, false).then(saved => {
      if (saved) setMessages(prev => prev.map(m => m.tempId === tempId ? saved : m))
    })

    setActiveSidebar(null)
    startMobilisation('signed_up_first_message')
  }, [sidebarData, setMessages, saveMessage, startMobilisation, userDetailsId])

  // ── Manual customer add ──────────────────────────────────────────────

  const handleAddManualCustomer = useCallback(async () => {
    const { organisation_name, organisation_website } = manualCustomerInput
    if (!organisation_name.trim()) return
    if (accountId) {
      await supabase.from('customers').insert({
        account_id: accountId,
        organisation_name: organisation_name.trim(),
        organisation_website: organisation_website.trim() || null,
      })
    }
    setManualCustomers(prev => [...prev, {
      organisation_name: organisation_name.trim(),
      organisation_website: organisation_website.trim(),
    }])
    setManualCustomerInput({ organisation_name: '', organisation_website: '' })
  }, [accountId, manualCustomerInput])

  // ── CSV / Excel handling ──────────────────────────────────────────────

  const handleCsvDrop = useCallback((e: any) => {
    e.preventDefault()
    setCsvDragOver(false)
    const file = e.dataTransfer?.files[0] ?? e.target.files?.[0]
    if (!file) return

    // Column aliases — case-insensitive, includes underscore variants
    const NAME_ALIASES = [
      'name', 'company', 'company name', 'company_name',
      'business', 'business name', 'business_name',
      'organisation', 'organisation name', 'organisation_name',
      'organization', 'organization name', 'organization_name',
      'client', 'client name', 'client_name',
      'customer', 'customer name', 'customer_name',
      'account', 'account name', 'account_name',
    ]
    const WEBSITE_ALIASES = [
      'website', 'url', 'domain', 'web', 'site', 'link',
      'company website', 'company_website', 'website url', 'website_url',
      'company url', 'company_url',
    ]

    // Normalise a raw header string: strip BOM, quotes, \r, collapse spaces
    function normaliseHeader(h: string): string {
      return h
        .replace(/^﻿/, '')   // strip UTF-8 BOM on first field
        .replace(/^"|"$/g, '')    // strip surrounding quotes
        .replace(/\r/g, '')       // strip Windows \r
        .toLowerCase()
        .trim()
    }

    async function processRows(rawRows: string[][]) {
      if (!rawRows.length) return
      const headers = rawRows[0].map(normaliseHeader)
      const nameCol = headers.findIndex(h => NAME_ALIASES.includes(h))
      const websiteCol = headers.findIndex(h => WEBSITE_ALIASES.includes(h))

      if (nameCol === -1) {
        setCsvError('Could not find a company name column. Please ensure your file has a column named "Company Name", "Business", "Organisation", or similar.')
        return
      }

      setCsvError(null)

      const rows = rawRows.slice(1).map(fields => ({
        organisation_name: String(fields[nameCol] ?? '').trim(),
        organisation_website: websiteCol !== -1 ? String(fields[websiteCol] ?? '').trim() : '',
      })).filter(r => r.organisation_name)

      if (accountId && rows.length) {
        const BATCH_SIZE = 500
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE)
          await supabase.from('customers').insert(batch.map(r => ({
            account_id: accountId,
            organisation_name: r.organisation_name,
            organisation_website: r.organisation_website || null,
          })))
        }
      }
      setCsvRows(rows)
    }

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')

    if (isExcel) {
      const reader = new FileReader()
      reader.onload = async (ev: any) => {
        const data = new Uint8Array(ev.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
        await processRows(rawRows)
      }
      reader.readAsArrayBuffer(file)
    } else {
      // CSV path — parse respecting quoted fields
      function parseCsvLine(line: string): string[] {
        const fields: string[] = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (ch === '"') { inQuotes = !inQuotes }
          else if (ch === ',' && !inQuotes) { fields.push(current); current = '' }
          else { current += ch }
        }
        fields.push(current)
        return fields
      }

      const reader = new FileReader()
      reader.onload = async (ev: any) => {
        const text = ev.target.result as string
        const lines = text.split('\n').filter((l: string) => l.trim())
        const rawRows = lines.map(parseCsvLine)
        await processRows(rawRows)
      }
      reader.readAsText(file)
    }
  }, [accountId])

  const downloadCsvTemplate = useCallback(() => {
    const csv = 'organisation_name,organisation_website\nAcme Corp,https://acmecorp.com\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'customers_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // ── ITP list loading (for select_itp sidebar) ────────────────────────

  const loadItpList = useCallback(async () => {
    if (!accountId) return
    setSelectedItpId(null)
    const { data } = await supabase
      .from('itp')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    setItpList(data ?? [])
  }, [accountId])

  // ── Key handler ──────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend()
  }, [handleSend])

  return {
    // Mobilisation state
    mobilisation_active,
    current_mobilisation,
    current_step,
    mobilisation_responses,
    input_bar_enabled,
    setInputBarEnabled,
    inputValue,
    setInputValue,
    inputRef,
    options,
    setOptions,

    // Mobilisation responses setter
    setMobilisationResponses,
    mobilisationResponsesRef,

    // Sidebar state
    activeSidebar,
    setActiveSidebar,
    sidebarData,
    setSidebarData,
    sidebarNextId,
    setSidebarNextId,

    // Customer input state
    manualCustomers,
    manualCustomerInput,
    setManualCustomerInput,
    csvRows,
    csvError,
    csvDragOver,
    setCsvDragOver,

    // ITP selection
    itpList,
    selectedItpId,
    setSelectedItpId,

    // Queue
    queueChecked,
    setQueueChecked,

    // Functions
    startMobilisation,
    resumeMobilisation,
    resetLocalMobilisationState,
    clearMobilisationState,
    checkQueuedMobilisations,
    handleSend,
    handleOptionSelect,
    handleSidebarAdvance,
    handleSaveCompanyDetails,
    handleSaveItp,
    handleAddManualCustomer,
    handleCsvDrop,
    downloadCsvTemplate,
    loadItpList,
    handleKeyDown,
  }
}

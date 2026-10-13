export interface Employee {
  name: string
  role: string
  img: string
}

export interface Message {
  id?: string
  tempId?: string
  message_body: string
  is_agent: boolean
  created_at?: string
  timestamp?: Date
  sidebar?: string
  sidebar_info?: Record<string, any>
  is_status?: boolean
  is_divider?: boolean
  navigate_to?: string
}

export interface MobilisationStep {
  id: string
  type: 'free_type' | 'option_set' | 'option_set_with_input' | 'ai_message' | 'ai_message_with_options' | 'end_flow' | 'sidebar' | 'validate'
  messages: string[]
  next_id?: string
  response_key?: string
  options?: StepOption[]
  sidebar?: string
}

export interface StepOption {
  id: number
  message: string
  next_id?: string
}

export interface Contact {
  id: string
  target_id?: string
  first_name: string | null
  last_name: string | null
  email: string
  role: string | null
  linkedin_url?: string | null
  phone?: string | null
  source?: string | null
}

export interface Target {
  id: string
  domain: string | null
  title: string | null
  link: string
  company_description?: string | null
  industry?: string | null
  employee_count?: number | null
  company_phone?: string | null
  company_linkedin?: string | null
  company_location?: string | null
  contacts?: Contact[]
}

export interface Lead {
  id: string
  target_id: string
  itp_id: string
  score: number
  score_reason: string | null
  approved?: boolean
  rejected?: boolean
  rejection_reason?: string | null
  targets?: Target & { contacts?: Contact[] }
}

export type LeadWithTarget = Lead & {
  targets: Target & { contacts: Contact[] }
}

export interface ITP {
  id: string
  name: string | null
  account_id?: string
  itp_summary?: string | null
  itp_demographic?: string | null
  itp_pain_points?: string | null
  itp_buying_trigger?: string | null
  location?: string | null
  created_at?: string
}

export interface CustomerInput {
  organisation_name: string
  organisation_website: string
}

export interface Account {
  id: string
  organisation_name: string | null
  organisation_website: string | null
  description: string | null
  problem_solved: string | null
  auto_approve_leads?: boolean
}

export interface Customer {
  id: string
  account_id: string
  organisation_website: string | null
}

// smtp_password is deliberately absent: the browser can't read it (column-level grant).
export interface Sender {
  id: string
  account_id: string
  email: string
  display_name: string | null
  smtp_host: string | null
  smtp_port: number | null
  smtp_username: string | null
  imap_host: string | null
  imap_port: number | null
  provider: string | null
  verified: boolean
}

export const SENDER_COLUMNS = 'id, account_id, email, display_name, smtp_host, smtp_port, smtp_username, imap_host, imap_port, provider, verified'

// Fields editable via PUT /api/senders/:id/credentials. A blank smtp_password keeps the stored one.
export type SenderUpdate = Partial<Omit<Sender, 'id' | 'account_id' | 'provider' | 'verified'>> & { smtp_password?: string }

export interface ItpStats {
  itpId: string
  leadCount: number
  avgScore: number
  approvedCount: number
  rejectedCount: number
  campaignCount: number
}

export interface ActivityMessage {
  id: string
  message_body: string
  is_agent: boolean
  is_status?: boolean
  created_at: string
}

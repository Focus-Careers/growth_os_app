-- Enable row level security on every public table flagged by the Supabase
-- security advisor (lint 0013 rls_disabled_in_public / 0023 sensitive_columns_exposed).
--
-- Access model:
--   * growth_os_server uses the service_role key, which bypasses RLS, so backend
--     behaviour is unchanged.
--   * The browser app (anon key + user JWT) gets policies scoped to the accounts
--     the signed-in user belongs to via user_details.auth_id = auth.uid().
--   * Tables the browser never touches get RLS with no policies (service_role only).

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can look up membership without recursing through
-- user_details RLS. Kept in a non-exposed schema so they aren't callable via RPC.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.my_account_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select ud.account_id from public.user_details ud
  where ud.auth_id = (select auth.uid()) and ud.account_id is not null
$$;

create or replace function private.my_user_details_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select ud.id from public.user_details ud
  where ud.auth_id = (select auth.uid())
$$;

-- targets are shared across accounts (no account_id); a user may see a target
-- when one of their leads, contacts or campaign contacts points at it.
create or replace function private.can_read_target(p_target_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
    join public.itp i on i.id = l.itp_id
    where l.target_id = p_target_id
      and i.account_id in (select private.my_account_ids())
  ) or exists (
    select 1 from public.contacts c
    where c.target_id = p_target_id
      and c.account_id in (select private.my_account_ids())
  ) or exists (
    select 1 from public.contacts c
    join public.campaign_contacts cc on cc.contact_id = c.id
    join public.campaigns cp on cp.id = cc.campaign_id
    where c.target_id = p_target_id
      and cp.account_id in (select private.my_account_ids())
  )
$$;

-- contacts belong to an account, but the server can enrol a contact owned by
-- another account into a campaign; those must still render on the campaign board.
create or replace function private.can_read_contact(p_contact_id uuid, p_account_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_account_id in (select private.my_account_ids())
  or exists (
    select 1 from public.campaign_contacts cc
    join public.campaigns c on c.id = cc.campaign_id
    where cc.contact_id = p_contact_id
      and c.account_id in (select private.my_account_ids())
  )
$$;

revoke all on function private.my_account_ids() from public;
revoke all on function private.my_user_details_ids() from public;
revoke all on function private.can_read_target(uuid) from public;
revoke all on function private.can_read_contact(uuid, uuid) from public;
grant execute on function private.my_account_ids() to authenticated;
grant execute on function private.my_user_details_ids() to authenticated;
grant execute on function private.can_read_target(uuid) to authenticated;
grant execute on function private.can_read_contact(uuid, uuid) to authenticated;

-- ── Indexes backing the policy lookups ──────────────────────────────────────

create index if not exists user_details_auth_id_idx on public.user_details (auth_id);
create index if not exists itp_account_id_idx on public.itp (account_id);
create index if not exists leads_itp_id_idx on public.leads (itp_id);
create index if not exists contacts_account_id_idx on public.contacts (account_id);
create index if not exists contacts_target_id_idx on public.contacts (target_id);
create index if not exists campaigns_account_id_idx on public.campaigns (account_id);
create index if not exists campaign_contacts_contact_id_idx on public.campaign_contacts (contact_id);
create index if not exists senders_account_id_idx on public.senders (account_id);
create index if not exists messages_user_details_id_idx on public.messages (user_details_id);

-- ── Enable RLS ──────────────────────────────────────────────────────────────

alter table public.account enable row level security;
alter table public.user_details enable row level security;
alter table public.messages enable row level security;
alter table public.itp enable row level security;
alter table public.leads enable row level security;
alter table public.targets enable row level security;
alter table public.contacts enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_contacts enable row level security;
alter table public.senders enable row level security;

-- Backend-only tables: no policies, so only service_role can access them.
alter table public.invites enable row level security;
alter table public.signup_processor_logs enable row level security;
alter table public.signup_sender_logs enable row level security;
alter table public.app_message_processor_logs enable row level security;
alter table public.lead_generation_runs enable row level security;
alter table public.target_finder_google_search_prompts enable row level security;
alter table public.watson_turn_logs enable row level security;

-- ── account ─────────────────────────────────────────────────────────────────

create policy "Members can read their accounts" on public.account
  for select to authenticated
  using (id in (select private.my_account_ids()));

create policy "Members can update their accounts" on public.account
  for update to authenticated
  using (id in (select private.my_account_ids()))
  with check (id in (select private.my_account_ids()));

-- ── user_details ────────────────────────────────────────────────────────────
-- Users may only touch their own rows, and only the self-service columns.
-- account_id, role, is_super_admin etc. stay server-controlled.

create policy "Users can read their own user_details" on public.user_details
  for select to authenticated
  using (auth_id = (select auth.uid()));

create policy "Users can update their own user_details" on public.user_details
  for update to authenticated
  using (auth_id = (select auth.uid()))
  with check (auth_id = (select auth.uid()));

revoke insert, update, delete on public.user_details from anon, authenticated;
grant update (firstname, active_mobilisation, active_step_id, queued_mobilisations)
  on public.user_details to authenticated;

-- ── messages ────────────────────────────────────────────────────────────────

create policy "Users can read their own messages" on public.messages
  for select to authenticated
  using (user_details_id in (select private.my_user_details_ids()));

create policy "Users can insert their own messages" on public.messages
  for insert to authenticated
  with check (user_details_id in (select private.my_user_details_ids()));

-- ── itp ─────────────────────────────────────────────────────────────────────

create policy "Members can read account itps" on public.itp
  for select to authenticated
  using (account_id in (select private.my_account_ids()));

create policy "Members can update account itps" on public.itp
  for update to authenticated
  using (account_id in (select private.my_account_ids()))
  with check (account_id in (select private.my_account_ids()));

-- ── leads ───────────────────────────────────────────────────────────────────

create policy "Members can read account leads" on public.leads
  for select to authenticated
  using (exists (
    select 1 from public.itp i
    where i.id = leads.itp_id and i.account_id in (select private.my_account_ids())
  ));

create policy "Members can update account leads" on public.leads
  for update to authenticated
  using (exists (
    select 1 from public.itp i
    where i.id = leads.itp_id and i.account_id in (select private.my_account_ids())
  ))
  with check (exists (
    select 1 from public.itp i
    where i.id = leads.itp_id and i.account_id in (select private.my_account_ids())
  ));

-- ── targets / contacts ──────────────────────────────────────────────────────

create policy "Members can read targets linked to their account" on public.targets
  for select to authenticated
  using (private.can_read_target(id));

create policy "Members can read account contacts" on public.contacts
  for select to authenticated
  using (private.can_read_contact(id, account_id));

-- ── campaigns ───────────────────────────────────────────────────────────────

create policy "Members can read account campaigns" on public.campaigns
  for select to authenticated
  using (account_id in (select private.my_account_ids()));

create policy "Members can update account campaigns" on public.campaigns
  for update to authenticated
  using (account_id in (select private.my_account_ids()))
  with check (account_id in (select private.my_account_ids()));

create policy "Members can read account campaign contacts" on public.campaign_contacts
  for select to authenticated
  using (exists (
    select 1 from public.campaigns c
    where c.id = campaign_contacts.campaign_id and c.account_id in (select private.my_account_ids())
  ));

-- campaign_contact_events already had RLS enabled but no policy, which hid the
-- per-campaign "sent" counts from the browser.
create policy "Members can read account campaign contact events" on public.campaign_contact_events
  for select to authenticated
  using (exists (
    select 1 from public.campaigns c
    where c.id = campaign_contact_events.campaign_id and c.account_id in (select private.my_account_ids())
  ));

-- ── senders ─────────────────────────────────────────────────────────────────

create policy "Members can read account senders" on public.senders
  for select to authenticated
  using (account_id in (select private.my_account_ids()));

create policy "Members can create account senders" on public.senders
  for insert to authenticated
  with check (account_id in (select private.my_account_ids()));

create policy "Members can update account senders" on public.senders
  for update to authenticated
  using (account_id in (select private.my_account_ids()))
  with check (account_id in (select private.my_account_ids()));

-- Keep SMTP credentials out of the browser.
--
-- Postgres can't revoke SELECT on a single column while a table-level SELECT
-- grant exists, so drop all browser-role privileges on senders and grant SELECT
-- back on an explicit allow-list of columns. smtp_password (and any column added
-- later) is therefore unreadable by anon/authenticated; `select('*')` from the
-- browser now fails with "permission denied".
--
-- Creating and updating senders goes through growth_os_server
-- (POST /api/senders, PUT /api/senders/:id/credentials), which checks account
-- membership and writes with the service-role key. The browser keeps a
-- read-only path to the non-sensitive columns, still scoped by the
-- "Members can read account senders" RLS policy.
--
-- Note: a blanket `grant ... on all tables in schema public to authenticated`
-- in a later migration would re-expose smtp_password.

revoke all on table public.senders from anon, authenticated;

grant select (
  id,
  account_id,
  email,
  display_name,
  provider,
  verified,
  verification_error,
  created_at,
  smtp_host,
  smtp_port,
  smtp_username,
  imap_host,
  imap_port
) on table public.senders to authenticated;

drop policy if exists "Members can create account senders" on public.senders;
drop policy if exists "Members can update account senders" on public.senders;

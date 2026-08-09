-- Fase D: RBAC real via Supabase Auth. Applies on top of
-- 20260808025100_create_secure_campaign_foundation.sql.

-- Every new auth.users row gets a profile with the lowest-privilege role by default.
-- Promoting someone to 'operator'/'owner' is a deliberate, separate admin action
-- (update the profiles row directly — no self-service role escalation is exposed anywhere).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (new.id, 'viewer', new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- Helper used by every staff-read policy below: is the current session a staff member
-- with at least the given role? Defined once so the rank order lives in a single place.
create or replace function public.is_staff(min_role text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (min_role = 'viewer' and p.role in ('viewer', 'operator', 'owner'))
        or (min_role = 'operator' and p.role in ('operator', 'owner'))
        or (min_role = 'owner' and p.role = 'owner')
      )
  );
$$;

-- Read access for authenticated staff. All writes still go exclusively through the
-- server-side API routes using the service-role key (which bypasses RLS entirely) —
-- these SELECT policies exist as defense-in-depth in case a client ever queries
-- Supabase directly, and so the RLS posture matches what the migration plan promised
-- ("políticas mínimas para administradores autenticados"), not just "RLS enabled, no policy".
create policy leads_staff_read on public.leads for select to authenticated using (public.is_staff('viewer'));
create policy lead_imports_staff_read on public.lead_imports for select to authenticated using (public.is_staff('operator'));
create policy lead_import_rows_staff_read on public.lead_import_rows for select to authenticated using (public.is_staff('operator'));
create policy campaigns_staff_read on public.campaigns for select to authenticated using (public.is_staff('viewer'));
create policy campaign_recipients_staff_read on public.campaign_recipients for select to authenticated using (public.is_staff('viewer'));
create policy message_jobs_staff_read on public.message_jobs for select to authenticated using (public.is_staff('operator'));
create policy message_attempts_staff_read on public.message_attempts for select to authenticated using (public.is_staff('operator'));
create policy inbound_messages_staff_read on public.inbound_messages for select to authenticated using (public.is_staff('operator'));
create policy opt_outs_staff_read on public.opt_outs for select to authenticated using (public.is_staff('viewer'));
create policy audit_logs_staff_read on public.audit_logs for select to authenticated using (public.is_staff('owner'));

-- profiles: owners can see the whole roster (needed to grant/revoke roles from the dashboard
-- or SQL editor); everyone can still read/update their own row per the original migration.
create policy profiles_staff_read_all on public.profiles for select to authenticated using (public.is_staff('owner'));

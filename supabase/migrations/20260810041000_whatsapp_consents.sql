-- Separates "a reviewer attached some evidence" (leads.consent_proof_reference, from
-- 20260810031000) from "this phone number authorized a specific category of communication" --
-- a lead can have a plausible-looking consent_proof_reference and still have no valid consent for
-- a given category, or have since revoked it. This table is the source of truth for that; it does
-- not replace or weaken the eligibility gate on `leads`, it gives that gate something more precise
-- to check against in a future iteration.

create type public.consent_category as enum ('service_order_updates', 'marketing_menu_offers');
create type public.consent_source as enum ('qr_code', 'click_to_whatsapp', 'checkout', 'inbound_whatsapp', 'manual_staff_entry');
create type public.consent_state as enum ('pending', 'granted', 'revoked');

create table public.whatsapp_consents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  category public.consent_category not null,
  state public.consent_state not null default 'pending',
  source public.consent_source not null,
  disclosure_version text not null,
  proof_message_id text,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (state != 'granted' or granted_at is not null),
  check (state != 'revoked' or revoked_at is not null)
);

-- One live consent record per (phone, category): granting again supersedes by inserting a new row
-- and the app is expected to treat the most recent row per (phone_e164, category) as authoritative.
create index whatsapp_consents_phone_category_idx on public.whatsapp_consents(phone_e164, category, created_at desc);
create index whatsapp_consents_lead_idx on public.whatsapp_consents(lead_id);

alter table public.whatsapp_consents enable row level security;

create policy whatsapp_consents_staff_read on public.whatsapp_consents
  for select to authenticated using (public.is_staff('viewer'));

create policy whatsapp_consents_operator_write on public.whatsapp_consents
  for insert to authenticated with check (public.is_staff('operator'));

comment on table public.whatsapp_consents is
  'Versioned, per-category consent records. Not yet consumed by the eligibility gate or the queue -- schema only, wiring is a follow-up.';

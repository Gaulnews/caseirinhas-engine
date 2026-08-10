-- Adds explicit consent-evidence and eligibility-review provenance to `leads`, on top of the
-- `legal_basis`/`purpose`/`source`/`collected_at`/`opted_out_at` columns already in place from
-- 20260808025100. This does not relax anything: `pending_review -> eligible` still requires a
-- manual, one-by-one review (src/app/api/leads/[id]/route.ts); this migration only makes that
-- review's evidence and accountability queryable/auditable instead of implicit.

alter table public.leads
  add column consent_proof_reference text,
  add column last_inbound_at timestamptz,
  add column eligibility_reviewed_by uuid references auth.users(id),
  add column eligibility_reviewed_at timestamptz;

comment on column public.leads.consent_proof_reference is
  'Pointer to the evidence a reviewer relied on to approve this lead (e.g. opt-in form submission id, order id, screenshot reference in storage). Required by application logic when moving a lead to eligible.';
comment on column public.leads.last_inbound_at is
  'Timestamp of the most recent inbound message received from this phone number, set by the messaging webhook. Used to reason about the 24h customer-service messaging window.';
comment on column public.leads.eligibility_reviewed_by is
  'auth.users id of the staff member who approved pending_review -> eligible. Null for leads never approved (still pending_review/invalid/blocked).';
comment on column public.leads.eligibility_reviewed_at is
  'Timestamp of the eligibility approval referenced by eligibility_reviewed_by.';

create index leads_last_inbound_at_idx on public.leads(last_inbound_at) where last_inbound_at is not null;

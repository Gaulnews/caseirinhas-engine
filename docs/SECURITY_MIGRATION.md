# Security migration

## Fase A-C (contenção) — merged to `master`

- `src/data/leads.ts` was removed from the security branch, then scrubbed from the entire Git history (`git-filter-repo`, force-pushed 2026-08-09).
- The legacy `GET`/`POST /api/cron` routes return HTTP 410 and no longer accept a `secret` query param.
- The public UI no longer imports or renders lead data directly.
- Every API route requires either a real staff session or, for a fixed set of lower-stakes/automation endpoints, `Authorization: Bearer <ADMIN_API_TOKEN>` (see below).

## Fase D (this change) — RBAC, campaigns, queue, opt-out webhook

### RBAC via Supabase Auth

- `profiles.role ∈ {owner, operator, viewer}`. A new `auth.users` row auto-creates a `viewer` profile (`20260809120000_staff_rbac_and_campaign_policies.sql` trigger); **promoting someone to `operator`/`owner` is a manual step** — update the `profiles` row directly in the Supabase dashboard/SQL editor. There is no self-service role escalation anywhere in the app.
- `src/lib/server/auth.ts` (`requireStaff`) is the single authorization gate for every API route: session-first, with the legacy `ADMIN_API_TOKEN` bearer kept as a documented, owner-equivalent bridge **only** for routes that don't need a real `auth.users` id to attribute a write to (`GET /api/leads`, `POST /api/imports`, `POST /api/opt-outs`). Campaign-mutating routes (create/start/pause/resume/cancel) reject the token bridge outright (`allowAdminToken: false`) because `campaigns.created_by` and the audit trail need a real user.
- `src/proxy.ts` (formerly `middleware.ts` — renamed by Next.js 16) does an **optimistic** redirect only (`/painel/*` → `/login` when no session cookie); it is not the security boundary. Every route re-verifies via `requireStaff`/`getPageStaffSession`.
- New RLS policies (`20260809120000_...sql`) give authenticated staff read access proportional to role, on top of the existing "RLS enabled, no policy = deny by default" posture from Fase C. All writes still go exclusively through server code using the service-role key.

### Lead approval workflow

- `PATCH /api/leads/:id` (and the panel's "Aprovar/Rejeitar" buttons) move a lead between `pending_review → eligible/invalid`, enforced by an explicit transition table — a lead can never jump straight from `pending_review` to `contacted`.
- **Consent/eligibility audit trail** (`20260810031000_lead_consent_and_eligibility_audit.sql`): approving a lead to `eligible` now requires a `consentProofReference` (a pointer to the evidence the reviewer relied on — an opt-in form submission id, an order id, a storage reference to a screenshot, etc.) and always records `eligibility_reviewed_by`/`eligibility_reviewed_at` from a real signed-in session. Both the API route and the panel's Server Action reject the transition with no reference, and the API route no longer accepts the `ADMIN_API_TOKEN` bridge at all (it never should have — see the original scope note above; the code just hadn't enforced it). A raw scraped/imported list (e.g. Google Places) has no such evidence and therefore cannot legitimately reach `eligible` through this gate.
- The messaging webhook (`POST /api/webhooks/messaging`) now also stamps `leads.last_inbound_at` on every inbound message, independent of opt-out detection — this is the signal that reopens the 24h customer-service messaging window, kept for future free-form-reply support even though the current provider only ever sends pre-approved templates.

### Campaigns + persistent queue

- `POST /api/campaigns` creates a `draft`. `POST /api/campaigns/:id/start` (owner-only) snapshots every currently-`eligible`, non-opted-out, not-contacted-in-30-days lead into `campaign_recipients`, then creates one `message_jobs` row per recipient with `run_after` staggered by the campaign's `min_interval_seconds` — never a burst.
- `POST /api/internal/queue/dispatch` (own secret, `QUEUE_DISPATCH_SECRET`, meant for an external scheduler — **no cron is configured yet**, see below) picks up due jobs, locks each with a conditional `UPDATE ... WHERE status='queued' AND locked_at IS NULL`, re-checks the lead's opt-out/eligibility status immediately before "sending", and enforces the campaign's `daily_limit`.
- `src/lib/server/messaging/provider.ts` also ships a `WhatsAppCloudApiProvider`, calling Meta's WhatsApp Business Cloud API directly. It is used automatically once `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_TEMPLATE_NAME` are all set (see below); with any of the three missing, `getMessagingProvider()` falls back to `NullMessagingProvider` and jobs keep resolving to `skipped` — same fail-closed posture as everywhere else in this codebase. The provider only ever sends an **already-approved template**, never raw text.
- **Structured template parameters** (`20260810040000_structured_campaign_template_parameters.sql`, `src/lib/server/campaign-template.ts`): `campaigns.message_template` is never sent to WhatsApp. Instead, `campaigns.template_parameters` is a validated JSONB object with strictly positional keys (`"1"`, `"2"`, ... → `{{1}}`, `{{2}}`, ... in the approved template — max 10 entries, max 500 chars each, no arbitrary field names accepted) and only those ordered values are sent as the template's body parameters. This closes a "template laundering" gap where free text typed into a campaign could otherwise turn an approved template into an arbitrary marketing message. Both campaign-creation paths (`POST /api/campaigns`, the panel's `createCampaignAction`) reject a campaign with missing/invalid `template_parameters`.
- The provider itself has no opinion on consent — it sends whatever `queue.ts` hands it. The actual gate is upstream: `enqueueCampaign` only ever snapshots leads that are `status = eligible` (i.e. individually approved through the `pending_review → eligible` review screen), and `dispatchDueJobs` re-checks eligibility and opt-out status immediately before every send. A real provider being wired up does not change, weaken, or bypass that gate.

### Opt-out

- `src/lib/server/opt-out.ts` is the single implementation shared by `POST /api/opt-outs` (staff-triggered), `POST /api/webhooks/messaging` (simplified bearer-secret endpoint, for manual/internal testing), and `POST /api/webhooks/whatsapp` (the real Meta Cloud API webhook — see below). All three paths: upsert `opt_outs`, mark the lead `opted_out`, and cancel every `queued`/`processing` job already scheduled for that phone.
- **Real Meta webhook** (`src/app/api/webhooks/whatsapp/route.ts`): `GET` implements Meta's `hub.challenge` verification handshake (checked against `WHATSAPP_WEBHOOK_VERIFY_TOKEN`); `POST` verifies the `X-Hub-Signature-256` header (HMAC-SHA256 over the raw request body, keyed with `META_APP_SECRET`) before parsing Meta's actual `entry[].changes[].value.messages[]` payload shape. A request with a missing/invalid signature is rejected with 401 before any parsing happens. This is distinct from `/api/webhooks/messaging`, which stays as a simplified bearer-secret endpoint with a hand-rolled payload shape for manual/internal testing — it is not what Meta actually calls.

### Consent (schema only, not yet wired into the gate)

- `20260810041000_whatsapp_consents.sql` adds a `whatsapp_consents` table: one row per (phone, category, event) with `category` (`service_order_updates` / `marketing_menu_offers`), `state` (`pending`/`granted`/`revoked`), `source`, `disclosure_version`, `proof_message_id`, and `granted_at`/`revoked_at`. This is more precise than `leads.consent_proof_reference` (a single free-text pointer) — it can express "this phone authorized order updates but not marketing", or "authorized, then revoked". **It is schema-only**: nothing in the API/queue reads from it yet. Wiring the eligibility gate and the queue to check it is a follow-up change, not done here.

## Required deployment configuration

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_API_TOKEN=
SUPABASE_ANON_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
QUEUE_DISPATCH_SECRET=
MESSAGE_PROVIDER_WEBHOOK_SECRET=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
META_APP_SECRET=
```

`SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are new in this change (needed for the session-bound Supabase Auth client in `proxy.ts`, Server Components, and the login form) — see `.env.example`.

`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_TEMPLATE_NAME` are optional — omit all three to keep the app in `NullMessagingProvider` (no-op) mode. To go live: create a WhatsApp Business Platform app in Meta's Developer Console (or via Composio/Rube if the WhatsApp connection is managed there), get a `phone_number_id` and a long-lived access token, and get a template approved by Meta — its name goes in `WHATSAPP_TEMPLATE_NAME`, its body-variable values are supplied per-campaign via `template_parameters` (see above), never hardcoded.

`WHATSAPP_WEBHOOK_VERIFY_TOKEN` / `META_APP_SECRET` are for the real Meta webhook (`/api/webhooks/whatsapp`) — the verify token is a string you invent and register in the Meta App Dashboard's webhook setup; the app secret is your Meta app's App Secret, used to verify `X-Hub-Signature-256`.

## What still requires a manual, real-infrastructure step (not doable from this session — no Supabase/Vercel access here)

1. **Apply the pending migrations to the real project, in order**: `20260810031000_lead_consent_and_eligibility_audit.sql` → `20260810040000_structured_campaign_template_parameters.sql` → `20260810041000_whatsapp_consents.sql`. Migrations `20260808025100_...sql` and `20260809120000_...sql` were confirmed applied via a Supabase MCP connection earlier in this project's history (verified with `execute_sql` at the time, including confirming the first `owner` user's `profiles.role`); that connection is intermittent across sessions — before assuming any migration's status either way, re-verify with `list_migrations` against the live project rather than trusting a prior session's notes or an externally-supplied status report.
2. **Create the first real `owner` user** in Supabase Auth and set their `profiles.role = 'owner'` manually — until then, nobody can use the panel, and only the `ADMIN_API_TOKEN` bridge works for the routes that still accept it.
3. **Set the new env vars** (`SUPABASE_ANON_KEY` and friends) in the Vercel project.
4. **Configure a real scheduler** (e.g. a Vercel Cron Job) to call `POST /api/internal/queue/dispatch` on an interval, if/when real dispatch is wanted — nothing calls it automatically today. Do not enable this until the go/no-go checklist below is complete.
5. **Set the `WHATSAPP_*` env vars** (access token, phone number id, approved template name, webhook verify token, app secret) in Vercel to activate `WhatsAppCloudApiProvider` and the real webhook — obtaining Meta credentials and getting a template approved are manual steps outside this session; see "Required deployment configuration" above.
6. **Register the webhook URL** (`https://<domain>/api/webhooks/whatsapp`) in the Meta App Dashboard so the `GET` verification handshake runs against `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
7. **Rotate `ADMIN_API_TOKEN`** once real staff accounts exist and the bridge is no longer needed day-to-day.
8. **Re-enable Vercel Deployment Protection for production.** On 2026-08-09, Vercel Authentication (SSO) was disabled project-wide (`update_project_deployment_protection`, `ssoProtection.enabled: false`) so a preview deployment could be reached without a Vercel team login. That call has no "production only" scope — the API's `deploymentType` enum is `all` / `preview` / `prod_deployment_urls_and_all_previews`, none of which protect production while leaving previews open. As a result **`caseirinhas-engine.vercel.app` (production) is currently reachable with no Vercel-level auth**, on top of whatever the app's own `requireStaff()`/RLS layer already enforces. Password Protection (a shared password, no Vercel account needed) would solve this properly but requires the team's paid "Advanced Deployment Protection" tier, which isn't enabled. Until this is revisited: either upgrade the Vercel plan and turn on Password Protection scoped to `preview`, or accept `all` (blocks preview access again) as an interim fix.

## Go/no-go checklist before any real send

This is the gate for turning `dispatchDueJobs` from a dormant code path into something an external scheduler actually calls. **Every item must be checked from a live, verified source (Supabase/Vercel/Meta dashboards or MCP tool output) — not from a prior session's notes or an externally-supplied report.**

- [ ] All three pending migrations applied and confirmed via `list_migrations` (see item 1 above)
- [ ] First real `owner` created, login tested end-to-end (`/login` → `/painel`, role shown correctly)
- [ ] `viewer` confirmed unable to approve leads or manage campaigns; `operator` confirmed unable to start/pause/resume/cancel
- [ ] A synthetic lead approved to `eligible` with a real `consentProofReference`, and `eligibility_reviewed_by`/`_at` confirmed populated in the database
- [ ] `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_TEMPLATE_NAME` set in Vercel; template confirmed **approved** (not pending) in Meta Business Manager
- [ ] Webhook URL registered with Meta and the `GET` verification handshake confirmed successful; a real inbound test message confirmed to land in `inbound_messages` with a valid `X-Hub-Signature-256`
- [ ] A synthetic draft campaign created with valid `template_parameters` matching the approved template's actual variable count
- [ ] Campaign started, dispatcher run manually (not yet on a schedule): confirms one `message_jobs` row, one `message_attempts` row, and either a real provider response or `messaging_provider_not_configured` if credentials are still absent
- [ ] Opt-out tested end-to-end: an inbound `SAIR`/`PARAR`/etc. message cancels queued jobs for that phone
- [ ] Only after all of the above: configure the external scheduler for `POST /api/internal/queue/dispatch`

## Test coverage

`npm test` (vitest) covers the pure logic that doesn't need a live database: CSV parsing (including a regression test for the exact `\n+` parser bug found and fixed during Fase C), Brazilian phone normalization, the role-hierarchy comparator, opt-out keyword detection, and template-parameter validation (positional-key enforcement, length/count limits, numeric ordering). Nothing in this repo can exercise the Supabase-backed code paths (RLS, the queue, the webhooks) end-to-end without a live project — `npm run build` + `tsc --noEmit` are the only checks that ran against that code here.

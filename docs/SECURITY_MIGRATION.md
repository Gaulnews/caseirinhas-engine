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

### Campaigns + persistent queue

- `POST /api/campaigns` creates a `draft`. `POST /api/campaigns/:id/start` (owner-only) snapshots every currently-`eligible`, non-opted-out, not-contacted-in-30-days lead into `campaign_recipients`, then creates one `message_jobs` row per recipient with `run_after` staggered by the campaign's `min_interval_seconds` — never a burst.
- `POST /api/internal/queue/dispatch` (own secret, `QUEUE_DISPATCH_SECRET`, meant for an external scheduler — **no cron is configured yet**, see below) picks up due jobs, locks each with a conditional `UPDATE ... WHERE status='queued' AND locked_at IS NULL`, re-checks the lead's opt-out/eligibility status immediately before "sending", and enforces the campaign's `daily_limit`.
- `src/lib/server/messaging/provider.ts` also ships a `WhatsAppCloudApiProvider`, calling Meta's WhatsApp Business Cloud API directly. It is used automatically once `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_TEMPLATE_NAME` are all set (see below); with any of the three missing, `getMessagingProvider()` falls back to `NullMessagingProvider` and jobs keep resolving to `skipped` — same fail-closed posture as everywhere else in this codebase. The provider only ever sends an **already-approved marketing template**, never raw text: WhatsApp requires an approved template for any business-initiated message outside the 24h customer-service window, so the campaign's free-text `message_template` is passed as that template's single `{{1}}` body variable, not sent verbatim.
- The provider itself has no opinion on consent — it sends whatever `queue.ts` hands it. The actual gate is upstream: `enqueueCampaign` only ever snapshots leads that are `status = eligible` (i.e. individually approved through the `pending_review → eligible` review screen), and `dispatchDueJobs` re-checks eligibility and opt-out status immediately before every send. A real provider being wired up does not change, weaken, or bypass that gate.

### Opt-out

- `src/lib/server/opt-out.ts` is now the single implementation shared by `POST /api/opt-outs` (staff-triggered) and `POST /api/webhooks/messaging` (inbound-keyword-triggered: `sair`/`parar`/`stop`/`remover`/`cancelar`, accent- and case-insensitive). Both paths: upsert `opt_outs`, mark the lead `opted_out`, and cancel every `queued`/`processing` job already scheduled for that phone.

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
```

`SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are new in this change (needed for the session-bound Supabase Auth client in `proxy.ts`, Server Components, and the login form) — see `.env.example`.

`WHATSAPP_*` are optional — omit all three to keep the app in `NullMessagingProvider` (no-op) mode. To go live: create a WhatsApp Business Platform app in Meta's Developer Console (or via Composio/Rube if the WhatsApp connection is managed there), get a `phone_number_id` and a long-lived access token, and get exactly one marketing template approved by Meta with a single `{{1}}` body variable — its name goes in `WHATSAPP_TEMPLATE_NAME`.

## What still requires a manual, real-infrastructure step (not doable from this session — no Supabase/Vercel access here)

1. **Apply `20260809120000_staff_rbac_and_campaign_policies.sql`** to the actual `caseirinhas-engine-staging` project (only `20260808025100_...sql` has been confirmed applied so far, per the source analysis).
2. **Create the first real `owner` user** in Supabase Auth and set their `profiles.role = 'owner'` manually — until then, nobody can use the panel, and only the `ADMIN_API_TOKEN` bridge works for the routes that still accept it.
3. **Set the new env vars** (`SUPABASE_ANON_KEY` and friends) in the Vercel project.
4. **Configure a real scheduler** (e.g. a Vercel Cron Job) to call `POST /api/internal/queue/dispatch` on an interval, if/when real dispatch is wanted — nothing calls it automatically today.
5. **Set the `WHATSAPP_*` env vars** (access token, phone number id, approved template name) in Vercel to activate `WhatsAppCloudApiProvider` — obtaining Meta credentials and getting a template approved are manual steps outside this session; see "Required deployment configuration" above.
6. **Rotate `ADMIN_API_TOKEN`** once real staff accounts exist and the bridge is no longer needed day-to-day.
7. **Re-enable Vercel Deployment Protection for production.** On 2026-08-09, Vercel Authentication (SSO) was disabled project-wide (`update_project_deployment_protection`, `ssoProtection.enabled: false`) so a preview deployment could be reached without a Vercel team login. That call has no "production only" scope — the API's `deploymentType` enum is `all` / `preview` / `prod_deployment_urls_and_all_previews`, none of which protect production while leaving previews open. As a result **`caseirinhas-engine.vercel.app` (production) is currently reachable with no Vercel-level auth**, on top of whatever the app's own `requireStaff()`/RLS layer already enforces. Password Protection (a shared password, no Vercel account needed) would solve this properly but requires the team's paid "Advanced Deployment Protection" tier, which isn't enabled. Until this is revisited: either upgrade the Vercel plan and turn on Password Protection scoped to `preview`, or accept `all` (blocks preview access again) as an interim fix.

## Test coverage

`npm test` (vitest) covers the pure logic that doesn't need a live database: CSV parsing (including a regression test for the exact `\n+` parser bug found and fixed during Fase C), Brazilian phone normalization, the role-hierarchy comparator, and opt-out keyword detection. Nothing in this repo can exercise the Supabase-backed code paths (RLS, the queue, the webhook) end-to-end without a live project — `npm run build` + `tsc --noEmit` are the only checks that ran against that code here.

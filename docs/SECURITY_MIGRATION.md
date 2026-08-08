# Security migration

## Current containment

- `src/data/leads.ts` was removed from the security branch.
- The legacy `GET /api/cron` and `POST /api/cron` routes return HTTP 410.
- The public UI no longer imports or renders lead data.
- Replacement APIs require `Authorization: Bearer <ADMIN_API_TOKEN>` and use the Supabase service-role key exclusively on the server.

## Required deployment configuration

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `ADMIN_API_TOKEN` in the deployment environment. Do not expose any of them using a `NEXT_PUBLIC_` prefix.

## Data handling

Imports must enter `lead_imports` and `lead_import_rows` first. New leads remain `pending_review`; no endpoint in this change sends messages. An opt-out must be stored in `opt_outs` before any campaign recipient is scheduled.

## Next implementation steps

1. Replace token-only administrative access with Supabase Auth and role checks.
2. Implement the CSV staging importer with E.164 normalization and duplicate reporting.
3. Implement campaign creation and a persistent worker that re-checks opt-outs before delivery.
4. Add webhook signature validation for inbound messages.
5. Review and rewrite public Git history if historical commits contain phone numbers or secrets.

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../supabase/server';
import { isStaffRole, roleMeetsMinimum, type StaffRole } from './roles';

export type StaffContext = {
  /** Real `auth.users.id` when authenticated via session; `null` for the legacy admin-token bridge. */
  actorId: string | null;
  role: StaffRole;
  via: 'session' | 'admin_token';
};

type StaffResult = { ok: true; staff: StaffContext } | { ok: false; response: NextResponse };

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

function hasLegacyAdminToken(request: Request): boolean {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

/**
 * Data Access Layer entry point for every staff-only route: verifies the caller is either
 * (a) a signed-in Supabase Auth user with a `profiles` row meeting the minimum role, or
 * (b) — when `allowAdminToken` is true — holding the long-lived server-only ADMIN_API_TOKEN,
 *     treated as owner-equivalent for backward compatibility with existing automation.
 *
 * Session auth is checked first and always wins when present. Route handlers that mutate rows
 * with a NOT NULL `auth.users` foreign key (e.g. `campaigns.created_by`) MUST pass
 * `allowAdminToken: false`, since the admin-token path has no real user id to attribute the write to.
 *
 * The session check is wrapped in try/catch on purpose: if Supabase env vars are missing or the
 * Auth service is unreachable, `createSupabaseServerClient()`/`getUser()` throw. Without the
 * try/catch that exception would propagate out of every route as an unhandled 500 — including
 * for callers using the admin-token bridge, which doesn't depend on Supabase being reachable at
 * all. A broken/misconfigured Supabase connection should degrade to "no session found", not take
 * down every API route.
 */
export async function requireStaff(
  request: Request,
  minimum: StaffRole,
  options: { allowAdminToken?: boolean } = {},
): Promise<StaffResult> {
  const allowAdminToken = options.allowAdminToken ?? true;

  const session = await checkSession(minimum);
  if (session) return session;

  if (allowAdminToken && hasLegacyAdminToken(request)) {
    return { ok: true, staff: { actorId: null, role: 'owner', via: 'admin_token' } };
  }

  return { ok: false, response: unauthorized() };
}

async function checkSession(minimum: StaffRole): Promise<StaffResult | null> {
  let user: { id: string } | null = null;
  let profileRole: string | null = null;
  let profileError = false;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();
    user = sessionUser;

    if (user) {
      const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      profileError = Boolean(error);
      profileRole = profile?.role ?? null;
    }
  } catch {
    // Supabase unreachable or misconfigured (missing env, network error, etc.) — treat as no session.
    return null;
  }

  if (!user) return null;
  if (profileError || !profileRole || !isStaffRole(profileRole)) {
    return { ok: false, response: forbidden('No staff profile found for this account') };
  }
  if (!roleMeetsMinimum(profileRole, minimum)) {
    return { ok: false, response: forbidden(`Requires ${minimum} role or higher`) };
  }
  return { ok: true, staff: { actorId: user.id, role: profileRole, via: 'session' } };
}

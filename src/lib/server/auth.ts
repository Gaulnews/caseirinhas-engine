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
 */
export async function requireStaff(
  request: Request,
  minimum: StaffRole,
  options: { allowAdminToken?: boolean } = {},
): Promise<StaffResult> {
  const allowAdminToken = options.allowAdminToken ?? true;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !profile || !isStaffRole(profile.role)) {
      return { ok: false, response: forbidden('No staff profile found for this account') };
    }
    if (!roleMeetsMinimum(profile.role, minimum)) {
      return { ok: false, response: forbidden(`Requires ${minimum} role or higher`) };
    }
    return { ok: true, staff: { actorId: user.id, role: profile.role, via: 'session' } };
  }

  if (allowAdminToken && hasLegacyAdminToken(request)) {
    return { ok: true, staff: { actorId: null, role: 'owner', via: 'admin_token' } };
  }

  return { ok: false, response: unauthorized() };
}

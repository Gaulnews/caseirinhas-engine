import 'server-only';
import { createSupabaseServerClient } from '../supabase/server';
import { isStaffRole, type StaffRole } from './roles';

export type PageStaffSession = { actorId: string; email: string | null; role: StaffRole };

/** Server Component / layout counterpart of `requireStaff` — no admin-token bridge here, since a browser page load always carries a session or nothing. */
export async function getPageStaffSession(): Promise<PageStaffSession | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || !isStaffRole(profile.role)) return null;

  return { actorId: user.id, email: user.email ?? null, role: profile.role };
}

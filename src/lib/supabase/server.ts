import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Session-bound client (anon key + user cookies). Respects RLS.
 * Use this to read `auth.uid()` / RLS-scoped rows on behalf of the signed-in staff member.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render; the proxy refreshes the session instead.
        }
      },
    },
  });
}

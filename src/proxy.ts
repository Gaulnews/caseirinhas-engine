import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PREFIX = '/painel';
const AUTH_ROUTE = '/login';

// Optimistic check only (per Next's auth guide): reads the session cookie and redirects
// unauthenticated visitors away from the panel. Every API route still runs its own
// requireStaff()/getPageStaffSession() check server-side — this is a UX shortcut, not the
// security boundary.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = pathname.startsWith(PROTECTED_PREFIX);
  const isAuthRoute = pathname === AUTH_ROUTE;

  if (isProtected && !user) {
    return NextResponse.redirect(new URL(AUTH_ROUTE, request.url));
  }
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL(PROTECTED_PREFIX, request.url));
  }

  return response;
}

export const config = {
  matcher: ['/painel/:path*', '/login'],
};

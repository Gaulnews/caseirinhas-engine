type RestOptions = RequestInit & { headers?: HeadersInit };

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function asHeaders(headers?: HeadersInit) {
  return new Headers(headers);
}

export function requireAdminApiToken(request: Request) {
  const expected = requiredEnv('ADMIN_API_TOKEN');
  const supplied = request.headers.get('authorization');
  if (supplied !== `Bearer ${expected}`) {
    return false;
  }
  return true;
}

export async function supabaseRest(path: string, options: RestOptions = {}) {
  const baseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const headers = asHeaders(options.headers);

  headers.set('apikey', serviceRoleKey);
  headers.set('authorization', `Bearer ${serviceRoleKey}`);
  headers.set('content-type', 'application/json');

  return fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers,
    cache: 'no-store',
  });
}

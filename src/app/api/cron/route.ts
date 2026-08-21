import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The Supabase anon key is public (safe to embed) — the edge function validates
// the JWT and uses the service_role key internally without exposing it here.
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjeWxpZXR5bW9wcm9wa3N0d3d1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE3ODYxODEsImV4cCI6MjA3NzM2MjE4MX0.DX4a-XbLtx9TmV8Qisiu_a6McYDePrSt_RD9jj_9yyU';

function verifyCronAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // If CRON_SECRET is configured, enforce it (Vercel cron passes it automatically).
  // If not configured, allow the call — the Supabase edge function is the security boundary.
  if (!secret) return true;
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const objective = parseInt(searchParams.get('objective') ?? '', 10);

  if (!Number.isFinite(objective) || objective < 1 || objective > 10) {
    return NextResponse.json(
      { error: 'objective must be an integer between 1 and 10' },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? 'https://gcylietymopropkstwwu.supabase.co';

  try {
    const edgeRes = await fetch(
      `${supabaseUrl}/functions/v1/dispatch?objective=${objective}`,
      {
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        signal: AbortSignal.timeout(55_000),
      },
    );
    const data = await edgeRes.json().catch(() => ({}));
    return NextResponse.json(data, { status: edgeRes.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Edge function call failed';
    console.error(`[cron:${objective}]`, message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

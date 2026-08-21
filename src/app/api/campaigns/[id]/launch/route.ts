import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EDGE_BASE = 'https://gcylietymopropkstwwu.supabase.co/functions/v1/admin-api';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const target = `${EDGE_BASE}/campaigns/${id}/launch`;
  const headers = new Headers();
  const auth = request.headers.get('authorization');
  if (auth) headers.set('Authorization', auth);
  headers.set('Content-Type', 'application/json');
  try {
    const res = await fetch(target, { method: 'POST', headers, signal: AbortSignal.timeout(55_000) });
    const text = await res.text();
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Edge function unreachable';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

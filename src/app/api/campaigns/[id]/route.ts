import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const EDGE_BASE = 'https://gcylietymopropkstwwu.supabase.co/functions/v1/admin-api';

async function proxyToEdge(req: NextRequest, edgePath: string): Promise<NextResponse> {
  const target = `${EDGE_BASE}/${edgePath}`;
  const headers = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) headers.set('Authorization', auth);
  headers.set('Content-Type', 'application/json');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.text().catch(() => undefined) : undefined;
  try {
    const res = await fetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Edge function unreachable';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  return proxyToEdge(request, `campaigns/${id}`);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  return proxyToEdge(request, `campaigns/${id}`);
}

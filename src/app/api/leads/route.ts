import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../lib/server/auth';
import { supabaseRest } from '../../../lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const staff = await requireStaff(request, 'viewer');
  if (!staff.ok) return staff.response;

  const { searchParams } = new URL(request.url);
  const requestedLimit = Number(searchParams.get('limit') ?? '50');
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const offset = Math.max(Number(searchParams.get('offset') ?? '0'), 0);
  const rawSearch = searchParams.get('search')?.trim() ?? '';
  const search = rawSearch.replace(/[^\p{L}\p{N} .+()-]/gu, '').slice(0, 80);
  const statusFilter = searchParams.get('status')?.trim() ?? '';

  const query = new URLSearchParams({
    select: 'id,company_name,phone_e164,neighborhood,city,state,status,created_at',
    deleted_at: 'is.null',
    order: 'created_at.desc',
    limit: String(limit),
    offset: String(offset),
  });

  if (statusFilter) query.set('status', `eq.${statusFilter}`);

  if (search) query.set('company_name', `ilike.*${search}*`);

  const response = await supabaseRest(`leads?${query.toString()}`);
  const body = await response.text();
  if (!response.ok) return NextResponse.json({ error: 'Unable to load leads' }, { status: 502 });

  return new NextResponse(body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

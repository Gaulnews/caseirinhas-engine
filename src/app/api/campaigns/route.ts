import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApiToken, supabaseRest } from '../../../lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!requireAdminApiToken(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  const params = new URLSearchParams({
    select: 'id,name,status,daily_limit,min_interval_seconds,scheduled_at,started_at,completed_at,created_at',
    order: 'created_at.desc',
    limit: '50',
  });
  if (status) params.set('status', `eq.${status}`);

  const res = await supabaseRest(`campaigns?${params.toString()}`);
  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: 'Unable to load campaigns' }, { status: 502 });

  return new NextResponse(body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!requireAdminApiToken(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const template = typeof body?.messageTemplate === 'string' ? body.messageTemplate.trim() : '';
  const dailyLimit = typeof body?.dailyLimit === 'number' ? Math.min(Math.max(Math.floor(body.dailyLimit), 0), 100) : 0;
  const minInterval = typeof body?.minIntervalSeconds === 'number' ? Math.max(Math.floor(body.minIntervalSeconds), 60) : 60;
  const scheduledAt = typeof body?.scheduledAt === 'string' ? body.scheduledAt : null;

  if (name.length < 2 || name.length > 140) return NextResponse.json({ error: 'name must be 2–140 chars' }, { status: 400 });
  if (template.length < 1 || template.length > 4096) return NextResponse.json({ error: 'messageTemplate must be 1–4096 chars' }, { status: 400 });

  // created_by requires an auth.users id; use a service-level sentinel UUID when running as API key auth
  const SERVICE_ACTOR = '00000000-0000-0000-0000-000000000001';

  const res = await supabaseRest('campaigns', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      name,
      message_template: template,
      daily_limit: dailyLimit,
      min_interval_seconds: minInterval,
      scheduled_at: scheduledAt,
      created_by: SERVICE_ACTOR,
    }]),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: 'Unable to create campaign' }, { status: 502 });

  return NextResponse.json(Array.isArray(data) ? data[0] : data, { status: 201 });
}

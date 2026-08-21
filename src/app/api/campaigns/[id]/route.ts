import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApiToken, supabaseRest } from '../../../../lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  if (!requireAdminApiToken(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const res = await supabaseRest(
    `campaigns?id=eq.${id}&select=id,name,message_template,status,daily_limit,min_interval_seconds,scheduled_at,started_at,completed_at,created_at`,
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: 'Unable to load campaign' }, { status: 502 });
  if (!Array.isArray(data) || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(data[0]);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!requireAdminApiToken(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const patch: Record<string, unknown> = {};

  if (typeof body?.name === 'string') {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 140) return NextResponse.json({ error: 'name must be 2–140 chars' }, { status: 400 });
    patch.name = name;
  }
  if (typeof body?.messageTemplate === 'string') {
    const t = body.messageTemplate.trim();
    if (t.length < 1 || t.length > 4096) return NextResponse.json({ error: 'messageTemplate must be 1–4096 chars' }, { status: 400 });
    patch.message_template = t;
  }
  if (typeof body?.status === 'string') {
    const allowed = ['draft', 'scheduled', 'paused', 'cancelled'];
    if (!allowed.includes(body.status)) return NextResponse.json({ error: `status must be one of: ${allowed.join(', ')}` }, { status: 400 });
    patch.status = body.status;
  }
  if (typeof body?.dailyLimit === 'number') patch.daily_limit = Math.min(Math.max(Math.floor(body.dailyLimit), 0), 100);
  if (typeof body?.minIntervalSeconds === 'number') patch.min_interval_seconds = Math.max(Math.floor(body.minIntervalSeconds), 60);
  if (typeof body?.scheduledAt === 'string') patch.scheduled_at = body.scheduledAt;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No patchable fields provided' }, { status: 400 });

  const res = await supabaseRest(`campaigns?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: 'Unable to update campaign' }, { status: 502 });
  if (!Array.isArray(data) || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(data[0]);
}

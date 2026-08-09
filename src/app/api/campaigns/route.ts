import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../lib/server/auth';
import { supabaseRest } from '../../../lib/server/supabase-rest';
import { logAudit } from '../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const staff = await requireStaff(request, 'viewer');
  if (!staff.ok) return staff.response;

  const query = new URLSearchParams({
    select: 'id,name,status,daily_limit,min_interval_seconds,scheduled_at,started_at,completed_at,created_at',
    order: 'created_at.desc',
    limit: '100',
  });
  const response = await supabaseRest(`campaigns?${query.toString()}`);
  const body = await response.text();
  if (!response.ok) return NextResponse.json({ error: 'Unable to load campaigns' }, { status: 502 });
  return new NextResponse(body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  // Draft creation needs a real auth.users id for campaigns.created_by (NOT NULL), so the
  // legacy admin-token bridge is intentionally not accepted here.
  const staff = await requireStaff(request, 'operator', { allowAdminToken: false });
  if (!staff.ok) return staff.response;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const messageTemplate = typeof body?.messageTemplate === 'string' ? body.messageTemplate.trim() : '';
  const dailyLimit = Number.isInteger(body?.dailyLimit) ? Math.min(Math.max(body.dailyLimit, 0), 100) : 20;
  const minIntervalSeconds = Number.isInteger(body?.minIntervalSeconds) ? Math.max(body.minIntervalSeconds, 60) : 90;

  if (name.length < 2 || name.length > 140) return NextResponse.json({ error: 'name must be 2-140 characters' }, { status: 400 });
  if (messageTemplate.length < 1 || messageTemplate.length > 4096) return NextResponse.json({ error: 'messageTemplate must be 1-4096 characters' }, { status: 400 });

  const insert = await supabaseRest('campaigns', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      {
        name,
        message_template: messageTemplate,
        daily_limit: dailyLimit,
        min_interval_seconds: minIntervalSeconds,
        created_by: staff.staff.actorId,
        status: 'draft',
      },
    ]),
  });
  const created = await insert.json().catch(() => null);
  if (!insert.ok || !created?.[0]) return NextResponse.json({ error: 'Unable to create campaign' }, { status: 502 });

  await logAudit({ actorId: staff.staff.actorId, action: 'campaign_created', entityType: 'campaign', entityId: created[0].id, metadata: { name } });

  return NextResponse.json({ success: true, campaign: created[0] }, { status: 201 });
}

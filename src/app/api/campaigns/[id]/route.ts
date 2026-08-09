import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../../lib/server/auth';
import { supabaseRest } from '../../../../lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(request, 'viewer');
  if (!staff.ok) return staff.response;

  const { id } = await params;
  const query = new URLSearchParams({
    select:
      'id,name,message_template,status,daily_limit,min_interval_seconds,scheduled_at,started_at,completed_at,created_at',
  });
  const response = await supabaseRest(`campaigns?id=eq.${id}&${query.toString()}`);
  const rows = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: 'Unable to load campaign' }, { status: 502 });
  if (!rows?.[0]) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const jobStatsResponse = await supabaseRest(
    `campaign_recipients?select=id,status&campaign_id=eq.${id}`,
  );
  const recipients = (await jobStatsResponse.json().catch(() => [])) as Array<{ status: string }>;
  const recipientsByStatus = recipients.reduce<Record<string, number>>((acc, recipient) => {
    acc[recipient.status] = (acc[recipient.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ campaign: rows[0], recipientCount: recipients.length, recipientsByStatus });
}

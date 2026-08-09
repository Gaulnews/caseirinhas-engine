import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../../../lib/server/auth';
import { supabaseRest } from '../../../../../lib/server/supabase-rest';
import { logAudit } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(request, 'owner', { allowAdminToken: false });
  if (!staff.ok) return staff.response;

  const { id } = await params;
  // Jobs left `queued` by pause are untouched, so resuming is just flipping the campaign
  // status back — the dispatcher's `campaign.status === 'running'` check does the rest.
  const update = await supabaseRest(`campaigns?id=eq.${id}&status=eq.paused`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'running' }),
  });
  const updated = await update.json().catch(() => null);
  if (!update.ok) return NextResponse.json({ error: 'Unable to resume campaign' }, { status: 502 });
  if (!updated?.[0]) return NextResponse.json({ error: "Campaign is not currently 'paused'" }, { status: 409 });

  await logAudit({ actorId: staff.staff.actorId, action: 'campaign_resumed', entityType: 'campaign', entityId: id });
  return NextResponse.json({ success: true, campaignId: id, status: 'running' });
}

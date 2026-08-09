import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../../../lib/server/auth';
import { supabaseRest } from '../../../../../lib/server/supabase-rest';
import { logAudit } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(request, 'owner', { allowAdminToken: false });
  if (!staff.ok) return staff.response;

  const { id } = await params;
  const update = await supabaseRest(`campaigns?id=eq.${id}&status=eq.running`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'paused' }),
  });
  const updated = await update.json().catch(() => null);
  if (!update.ok) return NextResponse.json({ error: 'Unable to pause campaign' }, { status: 502 });
  if (!updated?.[0]) return NextResponse.json({ error: "Campaign is not currently 'running'" }, { status: 409 });

  // Paused jobs are re-queued (not lost) by clearing run_after forward when resumed in a later
  // iteration; for now, pausing simply stops new sends by flipping campaign.status — the
  // dispatcher already checks `campaign.status === 'running'` before touching any job.
  await logAudit({ actorId: staff.staff.actorId, action: 'campaign_paused', entityType: 'campaign', entityId: id });
  return NextResponse.json({ success: true, campaignId: id, status: 'paused' });
}

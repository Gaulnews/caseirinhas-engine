import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../../../lib/server/auth';
import { supabaseRest } from '../../../../../lib/server/supabase-rest';
import { cancelPendingJobsForCampaign } from '../../../../../lib/server/queue';
import { logAudit } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(request, 'owner', { allowAdminToken: false });
  if (!staff.ok) return staff.response;

  const { id } = await params;
  const campaignResponse = await supabaseRest(`campaigns?select=status&id=eq.${id}`);
  const rows = await campaignResponse.json().catch(() => null);
  const status = rows?.[0]?.status as string | undefined;
  if (!status) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (status === 'completed' || status === 'cancelled') {
    return NextResponse.json({ error: `Campaign is already '${status}'` }, { status: 409 });
  }

  await cancelPendingJobsForCampaign(id);
  await supabaseRest(`campaigns?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'cancelled', completed_at: new Date().toISOString() }),
  });

  await logAudit({ actorId: staff.staff.actorId, action: 'campaign_cancelled', entityType: 'campaign', entityId: id });
  return NextResponse.json({ success: true, campaignId: id, status: 'cancelled' });
}

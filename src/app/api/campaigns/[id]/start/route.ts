import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../../../lib/server/auth';
import { supabaseRest } from '../../../../../lib/server/supabase-rest';
import { enqueueCampaign } from '../../../../../lib/server/queue';
import { logAudit } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

async function json<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Starting a campaign is the highest-stakes action short of a real send — restrict to owner
  // and require a real session (no admin-token bridge) so it always attributes to a person.
  const staff = await requireStaff(request, 'owner', { allowAdminToken: false });
  if (!staff.ok) return staff.response;

  const { id } = await params;
  const campaignResponse = await supabaseRest(`campaigns?select=id,status,min_interval_seconds&id=eq.${id}`);
  const campaigns = (await json<Array<{ id: string; status: string; min_interval_seconds: number }>>(campaignResponse)) ?? [];
  const campaign = campaigns[0];
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (campaign.status !== 'draft') {
    return NextResponse.json({ error: `Campaign must be in 'draft' to start (currently '${campaign.status}')` }, { status: 409 });
  }

  const outcome = await enqueueCampaign(id, campaign.min_interval_seconds).catch((error: unknown) => {
    return error instanceof Error ? error.message : 'enqueue_failed';
  });
  if (typeof outcome === 'string') return NextResponse.json({ error: outcome }, { status: 502 });

  await supabaseRest(`campaigns?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }),
  });

  await logAudit({
    actorId: staff.staff.actorId,
    action: 'campaign_started',
    entityType: 'campaign',
    entityId: id,
    metadata: outcome,
  });

  return NextResponse.json({ success: true, campaignId: id, ...outcome });
}

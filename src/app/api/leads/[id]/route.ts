import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../../lib/server/auth';
import { supabaseRest } from '../../../../lib/server/supabase-rest';
import { logAudit } from '../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending_review: ['eligible', 'invalid'],
  eligible: ['blocked', 'pending_review'],
  invalid: ['pending_review'],
  blocked: ['pending_review'],
};

async function json(response: Response) {
  return response.json().catch(() => null);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(request, 'operator');
  if (!staff.ok) return staff.response;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const nextStatus = typeof body?.status === 'string' ? body.status : '';

  const currentResponse = await supabaseRest(`leads?select=status&id=eq.${id}`);
  const currentRows = (await json(currentResponse)) as Array<{ status: string }> | null;
  const currentStatus = currentRows?.[0]?.status;
  if (!currentStatus) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    return NextResponse.json(
      { error: `Cannot move a lead from '${currentStatus}' to '${nextStatus}'`, allowedNext: allowed },
      { status: 400 },
    );
  }

  const update = await supabaseRest(`leads?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: nextStatus }),
  });
  if (!update.ok) return NextResponse.json({ error: 'Unable to update lead' }, { status: 502 });

  await logAudit({
    actorId: staff.staff.actorId,
    action: 'lead_status_change',
    entityType: 'lead',
    entityId: id,
    metadata: { from: currentStatus, to: nextStatus, via: staff.staff.via },
  });

  return NextResponse.json({ success: true, id, status: nextStatus });
}

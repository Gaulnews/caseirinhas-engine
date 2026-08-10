import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '../../../lib/server/auth';
import { applyOptOut } from '../../../lib/server/opt-out';
import { logAudit } from '../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const staff = await requireStaff(request, 'operator');
  if (!staff.ok) return staff.response;

  const body = await request.json().catch(() => null);
  const phone = typeof body?.phoneE164 === 'string' ? body.phoneE164.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

  const result = await applyOptOut(phone, reason, 'admin_api');
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error.includes('E.164') ? 400 : 502 });

  await logAudit({ actorId: staff.staff.actorId, action: 'opt_out_registered', entityType: 'opt_out', entityId: phone, metadata: { reason, source: 'admin_api', via: staff.staff.via } });

  return NextResponse.json({ success: true, phoneE164: phone });
}

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
  // Approving a lead as `eligible` is the one decision that turns a scraped/imported row into a
  // legitimate campaign target — it must always attribute to a real person, never the automation
  // token bridge (docs/SECURITY_MIGRATION.md already scoped this route out of the admin-token
  // allowlist; this just makes the code match that intent).
  const staff = await requireStaff(request, 'operator', { allowAdminToken: false });
  if (!staff.ok) return staff.response;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const nextStatus = typeof body?.status === 'string' ? body.status : '';
  const consentProofReference = typeof body?.consentProofReference === 'string' ? body.consentProofReference.trim() : '';

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

  // A lead can only become a campaign target if the reviewer points at verifiable evidence of
  // consent/legal basis — a status flip with no reference attached is exactly the gap a scraped
  // list (e.g. Google Places) would otherwise slip through.
  if (nextStatus === 'eligible' && !consentProofReference) {
    return NextResponse.json(
      { error: 'consentProofReference is required to approve a lead as eligible' },
      { status: 400 },
    );
  }

  const updatePayload: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === 'eligible') {
    updatePayload.consent_proof_reference = consentProofReference;
    updatePayload.eligibility_reviewed_by = staff.staff.actorId;
    updatePayload.eligibility_reviewed_at = new Date().toISOString();
  }

  const update = await supabaseRest(`leads?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(updatePayload),
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

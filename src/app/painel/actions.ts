'use server';

import { revalidatePath } from 'next/cache';
import { getPageStaffSession } from '../../lib/server/page-session';
import { roleMeetsMinimum, type StaffRole } from '../../lib/server/roles';
import { supabaseRest } from '../../lib/server/supabase-rest';
import { logAudit } from '../../lib/server/audit';
import { enqueueCampaign, cancelPendingJobsForCampaign } from '../../lib/server/queue';

async function requirePageStaff(minimum: StaffRole) {
  const session = await getPageStaffSession();
  if (!session || !roleMeetsMinimum(session.role, minimum)) {
    throw new Error('forbidden');
  }
  return session;
}

const LEAD_TRANSITIONS: Record<string, string[]> = {
  pending_review: ['eligible', 'invalid'],
  eligible: ['blocked', 'pending_review'],
  invalid: ['pending_review'],
  blocked: ['pending_review'],
};

export async function setLeadStatusAction(leadId: string, nextStatus: string, formData: FormData) {
  // Approving a lead requires a real signed-in session (requirePageStaff always resolves a real
  // actor from getPageStaffSession — there is no admin-token bridge on this Server Action path),
  // so eligibility_reviewed_by is never null for an eligible lead.
  const session = await requirePageStaff('operator');

  const currentResponse = await supabaseRest(`leads?select=status&id=eq.${leadId}`);
  const rows = await currentResponse.json().catch(() => null);
  const currentStatus = rows?.[0]?.status as string | undefined;
  if (!currentStatus || !(LEAD_TRANSITIONS[currentStatus] ?? []).includes(nextStatus)) {
    throw new Error(`invalid transition from ${currentStatus} to ${nextStatus}`);
  }

  const consentProofReference = String(formData.get('consentProofReference') ?? '').trim();
  if (nextStatus === 'eligible' && !consentProofReference) {
    throw new Error('consentProofReference is required to approve a lead as eligible');
  }

  const updatePayload: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === 'eligible') {
    updatePayload.consent_proof_reference = consentProofReference;
    updatePayload.eligibility_reviewed_by = session.actorId;
    updatePayload.eligibility_reviewed_at = new Date().toISOString();
  }

  await supabaseRest(`leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(updatePayload),
  });
  await logAudit({ actorId: session.actorId, action: 'lead_status_change', entityType: 'lead', entityId: leadId, metadata: { from: currentStatus, to: nextStatus, via: 'panel' } });
  revalidatePath('/painel');
}

export async function createCampaignAction(formData: FormData) {
  const session = await requirePageStaff('operator');

  const name = String(formData.get('name') ?? '').trim();
  const messageTemplate = String(formData.get('messageTemplate') ?? '').trim();
  const dailyLimit = Math.min(Math.max(Number(formData.get('dailyLimit') ?? 20), 0), 100);
  const minIntervalSeconds = Math.max(Number(formData.get('minIntervalSeconds') ?? 90), 60);

  if (name.length < 2 || messageTemplate.length < 1) throw new Error('invalid campaign fields');

  const insert = await supabaseRest('campaigns', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      { name, message_template: messageTemplate, daily_limit: dailyLimit, min_interval_seconds: minIntervalSeconds, created_by: session.actorId, status: 'draft' },
    ]),
  });
  const created = await insert.json().catch(() => null);
  if (!insert.ok || !created?.[0]) throw new Error('unable to create campaign');

  await logAudit({ actorId: session.actorId, action: 'campaign_created', entityType: 'campaign', entityId: created[0].id, metadata: { name, via: 'panel' } });
  revalidatePath('/painel/campanhas');
}

export async function startCampaignAction(campaignId: string) {
  const session = await requirePageStaff('owner');

  const campaignResponse = await supabaseRest(`campaigns?select=status,min_interval_seconds&id=eq.${campaignId}`);
  const rows = await campaignResponse.json().catch(() => null);
  const campaign = rows?.[0] as { status: string; min_interval_seconds: number } | undefined;
  if (!campaign || campaign.status !== 'draft') throw new Error('campaign must be draft to start');

  const outcome = await enqueueCampaign(campaignId, campaign.min_interval_seconds);
  await supabaseRest(`campaigns?id=eq.${campaignId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }) });
  await logAudit({ actorId: session.actorId, action: 'campaign_started', entityType: 'campaign', entityId: campaignId, metadata: { ...outcome, via: 'panel' } });
  revalidatePath(`/painel/campanhas/${campaignId}`);
  revalidatePath('/painel/campanhas');
}

export async function pauseCampaignAction(campaignId: string) {
  const session = await requirePageStaff('owner');
  await supabaseRest(`campaigns?id=eq.${campaignId}&status=eq.running`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'paused' }) });
  await logAudit({ actorId: session.actorId, action: 'campaign_paused', entityType: 'campaign', entityId: campaignId, metadata: { via: 'panel' } });
  revalidatePath(`/painel/campanhas/${campaignId}`);
}

export async function resumeCampaignAction(campaignId: string) {
  const session = await requirePageStaff('owner');
  await supabaseRest(`campaigns?id=eq.${campaignId}&status=eq.paused`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'running' }) });
  await logAudit({ actorId: session.actorId, action: 'campaign_resumed', entityType: 'campaign', entityId: campaignId, metadata: { via: 'panel' } });
  revalidatePath(`/painel/campanhas/${campaignId}`);
}

export async function cancelCampaignAction(campaignId: string) {
  const session = await requirePageStaff('owner');
  await cancelPendingJobsForCampaign(campaignId);
  await supabaseRest(`campaigns?id=eq.${campaignId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelled', completed_at: new Date().toISOString() }) });
  await logAudit({ actorId: session.actorId, action: 'campaign_cancelled', entityType: 'campaign', entityId: campaignId, metadata: { via: 'panel' } });
  revalidatePath(`/painel/campanhas/${campaignId}`);
  revalidatePath('/painel/campanhas');
}

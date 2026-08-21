import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApiToken, supabaseRest } from '../../../../../lib/server/supabase-rest';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 50;

type Params = { params: Promise<{ id: string }> };

async function jsonOrNull<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null);
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!requireAdminApiToken(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: campaignId } = await params;
  if (!UUID.test(campaignId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  // 1. Load campaign and verify it can be launched
  const campaignRes = await supabaseRest(
    `campaigns?id=eq.${campaignId}&select=id,status,min_interval_seconds,daily_limit`,
  );
  const campaigns = await jsonOrNull<Array<Record<string, unknown>>>(campaignRes);
  if (!campaignRes.ok || !Array.isArray(campaigns) || campaigns.length === 0) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  const campaign = campaigns[0];
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    return NextResponse.json(
      { error: `Cannot launch a campaign with status '${campaign.status}'. Must be draft or scheduled.` },
      { status: 409 },
    );
  }

  const minIntervalMs = Math.max(Number(campaign.min_interval_seconds) || 60, 60) * 1000;

  // 2. Fetch all eligible leads (not opted out, not already in this campaign)
  const leadsRes = await supabaseRest(
    `leads?status=eq.eligible&deleted_at=is.null&select=id&order=created_at.asc&limit=500`,
  );
  const leads = await jsonOrNull<Array<{ id: string }>>(leadsRes);
  if (!leadsRes.ok || !Array.isArray(leads)) {
    return NextResponse.json({ error: 'Unable to load leads' }, { status: 502 });
  }
  if (leads.length === 0) {
    return NextResponse.json({ error: 'No eligible leads found' }, { status: 422 });
  }

  // 3. Find leads already enrolled in this campaign to avoid duplicates
  const enrolledRes = await supabaseRest(
    `campaign_recipients?campaign_id=eq.${campaignId}&select=lead_id`,
  );
  const enrolled = await jsonOrNull<Array<{ lead_id: string }>>(enrolledRes);
  const enrolledSet = new Set((enrolled ?? []).map((r) => r.lead_id));
  const newLeads = leads.filter((l) => !enrolledSet.has(l.id));

  if (newLeads.length === 0) {
    // All leads already enrolled; just set status to running
    await supabaseRest(`campaigns?id=eq.${campaignId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }),
    });
    return NextResponse.json({ success: true, enrolledCount: 0, jobsCreated: 0, message: 'All leads already enrolled; campaign set to running.' });
  }

  // 4. Bulk-insert campaign_recipients
  const recipientRows = newLeads.map((l) => ({ campaign_id: campaignId, lead_id: l.id, status: 'queued' }));
  const insertedRecipientIds: string[] = [];

  for (let i = 0; i < recipientRows.length; i += CHUNK) {
    const chunk = recipientRows.slice(i, i + CHUNK);
    const res = await supabaseRest('campaign_recipients?on_conflict=campaign_id,lead_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(chunk),
    });
    const inserted = await jsonOrNull<Array<{ id: string }>>(res);
    if (!res.ok) return NextResponse.json({ error: 'Failed to enroll recipients' }, { status: 502 });
    for (const r of inserted ?? []) insertedRecipientIds.push(r.id);
  }

  if (insertedRecipientIds.length === 0) {
    await supabaseRest(`campaigns?id=eq.${campaignId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }),
    });
    return NextResponse.json({ success: true, enrolledCount: 0, jobsCreated: 0, message: 'No new recipients; campaign set to running.' });
  }

  // 5. Create staggered message_jobs for each new recipient
  const baseTime = Date.now();
  const jobRows = insertedRecipientIds.map((recipientId, index) => ({
    campaign_recipient_id: recipientId,
    run_after: new Date(baseTime + index * minIntervalMs).toISOString(),
    status: 'queued',
  }));

  let jobsCreated = 0;
  for (let i = 0; i < jobRows.length; i += CHUNK) {
    const chunk = jobRows.slice(i, i + CHUNK);
    const res = await supabaseRest('message_jobs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) return NextResponse.json({ error: 'Failed to enqueue message jobs', enrolledCount: insertedRecipientIds.length, jobsCreated }, { status: 502 });
    jobsCreated += chunk.length;
  }

  // 6. Activate campaign
  await supabaseRest(`campaigns?id=eq.${campaignId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }),
  });

  const lastJobTime = new Date(baseTime + (jobRows.length - 1) * minIntervalMs);
  return NextResponse.json({
    success: true,
    campaignId,
    enrolledCount: insertedRecipientIds.length,
    jobsCreated,
    firstJobAt: new Date(baseTime).toISOString(),
    lastJobAt: lastJobTime.toISOString(),
  }, { status: 201 });
}

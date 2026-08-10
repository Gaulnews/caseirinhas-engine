import { supabaseRest } from './supabase-rest';
import { getMessagingProvider } from './messaging/provider';

const RECONTACT_COOLDOWN_DAYS = 30;
const MAX_RECIPIENTS_PER_START = 500;

async function json<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null);
}

/** Leads eligible for a NEW campaign right now: approved, not opted out, not deleted, not contacted in the cooldown window. */
export async function computeEligibleLeadIds(limit = MAX_RECIPIENTS_PER_START): Promise<string[]> {
  const cutoff = new Date(Date.now() - RECONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const query = new URLSearchParams({
    select: 'id',
    status: 'eq.eligible',
    deleted_at: 'is.null',
    opted_out_at: 'is.null',
    or: `(last_contacted_at.is.null,last_contacted_at.lt.${cutoff})`,
    limit: String(limit),
  });
  const response = await supabaseRest(`leads?${query.toString()}`);
  if (!response.ok) throw new Error('Unable to compute eligible leads');
  const rows = (await json<Array<{ id: string }>>(response)) ?? [];
  return rows.map((row) => row.id);
}

export type EnqueueOutcome = { recipientCount: number; jobCount: number };

/**
 * Snapshots the currently eligible leads into `campaign_recipients`, then creates one
 * `message_jobs` row per recipient with a staggered `run_after` (spaced by the campaign's
 * `min_interval_seconds`) so the dispatcher never bursts. Idempotent at the DB level:
 * `campaign_recipients` has a unique (campaign_id, lead_id) constraint, so re-running this
 * for the same campaign never duplicates a recipient or its job.
 */
export async function enqueueCampaign(campaignId: string, minIntervalSeconds: number): Promise<EnqueueOutcome> {
  const leadIds = await computeEligibleLeadIds();
  if (leadIds.length === 0) return { recipientCount: 0, jobCount: 0 };

  const insertRecipients = await supabaseRest('campaign_recipients?on_conflict=campaign_id,lead_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(leadIds.map((leadId) => ({ campaign_id: campaignId, lead_id: leadId }))),
  });
  if (!insertRecipients.ok) throw new Error('Unable to create campaign recipients');
  const recipients = (await json<Array<{ id: string }>>(insertRecipients)) ?? [];

  // Recipients that already had a job from a previous (e.g. resumed) enqueue must not get a second one.
  const recipientIds = recipients.map((recipient) => recipient.id);
  const existingJobsResponse = recipientIds.length
    ? await supabaseRest(`message_jobs?select=campaign_recipient_id&campaign_recipient_id=in.(${recipientIds.join(',')})`)
    : null;
  const alreadyQueued = new Set(
    ((await json<Array<{ campaign_recipient_id: string }>>(existingJobsResponse ?? new Response('[]'))) ?? []).map(
      (row) => row.campaign_recipient_id,
    ),
  );

  const now = Date.now();
  const jobsPayload = recipients
    .filter((recipient) => !alreadyQueued.has(recipient.id))
    .map((recipient, index) => ({
      campaign_recipient_id: recipient.id,
      run_after: new Date(now + index * minIntervalSeconds * 1000).toISOString(),
    }));

  const CHUNK = 100;
  for (let start = 0; start < jobsPayload.length; start += CHUNK) {
    const insertJobs = await supabaseRest('message_jobs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(jobsPayload.slice(start, start + CHUNK)),
    });
    if (!insertJobs.ok) throw new Error('Unable to create message jobs');
  }

  return { recipientCount: recipients.length, jobCount: jobsPayload.length };
}

/** Cancels every queued/processing job belonging to a campaign. Used by pause and cancel. */
export async function cancelPendingJobsForCampaign(campaignId: string): Promise<void> {
  const recipientsResponse = await supabaseRest(`campaign_recipients?select=id&campaign_id=eq.${campaignId}`);
  if (!recipientsResponse.ok) throw new Error('Unable to load campaign recipients');
  const recipients = (await json<Array<{ id: string }>>(recipientsResponse)) ?? [];
  if (recipients.length === 0) return;

  const idList = recipients.map((recipient) => recipient.id).join(',');
  await supabaseRest(`message_jobs?campaign_recipient_id=in.(${idList})&status=in.(queued,processing)`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
}

type DueJob = {
  id: string;
  campaign_recipient_id: string;
  attempts: number;
  campaign_recipients: {
    lead_id: string;
    campaigns: { id: string; status: string; daily_limit: number; min_interval_seconds: number; message_template: string };
  };
};

type CampaignDailyBudget = { limit: number; sentToday: number };

async function loadDailyBudget(campaignId: string, dailyLimit: number): Promise<CampaignDailyBudget> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const recipientsResponse = await supabaseRest(`campaign_recipients?select=id&campaign_id=eq.${campaignId}`);
  const recipients = (await json<Array<{ id: string }>>(recipientsResponse)) ?? [];
  if (recipients.length === 0) return { limit: dailyLimit, sentToday: 0 };

  const recipientIds = recipients.map((recipient) => recipient.id).join(',');
  const jobsResponse = await supabaseRest(`message_jobs?select=id&campaign_recipient_id=in.(${recipientIds})`);
  const jobs = (await json<Array<{ id: string }>>(jobsResponse)) ?? [];
  if (jobs.length === 0) return { limit: dailyLimit, sentToday: 0 };

  const jobIds = jobs.map((job) => job.id).join(',');
  const attemptsResponse = await supabaseRest(
    `message_attempts?select=id&message_job_id=in.(${jobIds})&outcome=in.(accepted,sent,delivered)&attempted_at=gte.${startOfDay.toISOString()}`,
  );
  if (!attemptsResponse.ok) return { limit: dailyLimit, sentToday: dailyLimit }; // fail closed: exhaust the budget rather than risk a burst
  const attempts = (await json<Array<{ id: string }>>(attemptsResponse)) ?? [];
  return { limit: dailyLimit, sentToday: attempts.length };
}

export type DispatchSummary = { attempted: number; sent: number; skipped: number; failed: number; deferred: number };

/**
 * Picks up due, queued jobs and processes them one at a time. Every job is locked with a
 * conditional PATCH (`status=eq.queued&locked_at=is.null`) before processing, so two concurrent
 * dispatcher invocations can never double-send the same job. No real message is ever sent today
 * (see `messaging/provider.ts`) — every job resolves to `skipped` until a provider is wired up.
 */
export async function dispatchDueJobs(limit = 20, workerId = 'internal-dispatcher'): Promise<DispatchSummary> {
  const provider = getMessagingProvider();
  const summary: DispatchSummary = { attempted: 0, sent: 0, skipped: 0, failed: 0, deferred: 0 };
  const budgetByCampaign = new Map<string, CampaignDailyBudget>();

  const query = new URLSearchParams({
    select:
      'id,campaign_recipient_id,attempts,campaign_recipients(lead_id,campaigns(id,status,daily_limit,min_interval_seconds,message_template))',
    status: 'eq.queued',
    locked_at: 'is.null',
    run_after: `lte.${new Date().toISOString()}`,
    order: 'run_after.asc',
    limit: String(limit),
  });
  const dueResponse = await supabaseRest(`message_jobs?${query.toString()}`);
  if (!dueResponse.ok) throw new Error('Unable to load due jobs');
  const dueJobs = (await json<DueJob[]>(dueResponse)) ?? [];

  for (const job of dueJobs) {
    const campaign = job.campaign_recipients?.campaigns;
    if (!campaign || campaign.status !== 'running') {
      summary.deferred += 1;
      continue;
    }

    if (!budgetByCampaign.has(campaign.id)) {
      budgetByCampaign.set(campaign.id, await loadDailyBudget(campaign.id, campaign.daily_limit));
    }
    const budget = budgetByCampaign.get(campaign.id)!;
    if (budget.sentToday >= budget.limit) {
      summary.deferred += 1;
      continue;
    }

    const lockResponse = await supabaseRest(`message_jobs?id=eq.${job.id}&status=eq.queued&locked_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: workerId,
        attempts: job.attempts + 1,
      }),
    });
    if (!lockResponse.ok) continue;
    const locked = (await json<Array<{ id: string }>>(lockResponse)) ?? [];
    if (locked.length === 0) continue; // another worker won the race

    summary.attempted += 1;

    const phone = await leadPhone(job.campaign_recipients.lead_id);
    const [optedOut, leadRows] = await Promise.all([hasOptOut(phone), leadStatus(job.campaign_recipients.lead_id)]);
    const stillEligible = leadRows === 'eligible' && !optedOut && phone.length > 0;

    if (!stillEligible) {
      await finishJob(job.id, 'cancelled', 'cancelled', 'lead_no_longer_eligible');
      summary.skipped += 1;
      continue;
    }

    const result = await provider.send(phone, campaign.message_template);

    if (result.ok) {
      await finishJob(job.id, 'sent', 'sent', null, result.providerMessageId);
      await supabaseRest(`leads?id=eq.${job.campaign_recipients.lead_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'contacted', last_contacted_at: new Date().toISOString() }),
      });
      budget.sentToday += 1;
      summary.sent += 1;
    } else {
      await finishJob(job.id, 'skipped', 'skipped', result.errorMessage);
      summary.skipped += 1;
    }
  }

  return summary;
}

async function leadPhone(leadId: string): Promise<string> {
  const response = await supabaseRest(`leads?select=phone_e164&id=eq.${leadId}`);
  const rows = (await json<Array<{ phone_e164: string }>>(response)) ?? [];
  return rows[0]?.phone_e164 ?? '';
}

async function leadStatus(leadId: string): Promise<string | null> {
  const response = await supabaseRest(`leads?select=status&id=eq.${leadId}`);
  const rows = (await json<Array<{ status: string }>>(response)) ?? [];
  return rows[0]?.status ?? null;
}

async function hasOptOut(phoneE164: string): Promise<boolean> {
  if (!phoneE164) return false;
  const response = await supabaseRest(`opt_outs?select=id&phone_e164=eq.${encodeURIComponent(phoneE164)}`);
  const rows = (await json<Array<{ id: string }>>(response)) ?? [];
  return rows.length > 0;
}

async function finishJob(
  jobId: string,
  jobStatus: 'sent' | 'skipped' | 'cancelled' | 'failed',
  attemptOutcome: 'sent' | 'skipped' | 'cancelled' | 'failed',
  errorMessage: string | null,
  providerMessageId?: string,
) {
  await Promise.all([
    supabaseRest(`message_jobs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: jobStatus, last_error: errorMessage, locked_at: null, locked_by: null }),
    }),
    supabaseRest('message_attempts', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        {
          message_job_id: jobId,
          provider_message_id: providerMessageId ?? null,
          outcome: attemptOutcome,
          error_message: errorMessage,
        },
      ]),
    }),
  ]);
}

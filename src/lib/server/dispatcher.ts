import { supabaseRest } from './supabase-rest';
import { sendWhatsAppText } from './whatsapp';

const BATCH_SIZE = 15;
const LOCK_ID = `cron-${(process.env.VERCEL_REGION ?? 'local').slice(0, 20)}`;

export type DispatchSummary = {
  objective: number;
  fetched: number;
  sent: number;
  failed: number;
  skipped: number;
};

type RawJob = {
  id: string;
  idempotency_key: string;
  campaign_recipient_id: string;
  campaign_recipients: {
    id: string;
    campaign_id: string;
    lead_id: string;
    campaigns: {
      id: string;
      message_template: string;
      daily_limit: number;
      min_interval_seconds: number;
      status: string;
    };
    leads: {
      id: string;
      phone_e164: string;
      company_name: string;
      status: string;
    };
  };
};

async function jsonOrNull<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null);
}

export async function runDispatch(objective: number): Promise<DispatchSummary> {
  const summary: DispatchSummary = { objective, fetched: 0, sent: 0, failed: 0, skipped: 0 };
  const now = new Date().toISOString();

  const crFields = [
    'id',
    'campaign_id',
    'lead_id',
    'campaigns!inner(id,message_template,daily_limit,min_interval_seconds,status)',
    'leads!inner(id,phone_e164,company_name,status)',
  ].join(',');
  const select = `id,idempotency_key,campaign_recipient_id,campaign_recipients!inner(${crFields})`;

  const params = new URLSearchParams({
    select,
    status: 'eq.queued',
    run_after: `lte.${now}`,
    locked_at: 'is.null',
    order: 'run_after.asc',
    limit: String(BATCH_SIZE),
  });

  const res = await supabaseRest(`message_jobs?${params.toString()}`);
  if (!res.ok) {
    console.error(`[dispatcher:${objective}] fetch failed — HTTP ${res.status}`);
    return summary;
  }

  const jobs = await jsonOrNull<RawJob[]>(res);
  if (!Array.isArray(jobs) || jobs.length === 0) return summary;
  summary.fetched = jobs.length;

  for (const job of jobs) {
    const cr = job.campaign_recipients;
    const campaign = cr?.campaigns;
    const lead = cr?.leads;

    if (!cr || !campaign || !lead) { summary.skipped++; continue; }
    if (campaign.status !== 'running') { summary.skipped++; continue; }
    if (lead.status !== 'eligible') { summary.skipped++; continue; }

    // Optimistic lock: only updates if the job is still queued and unlocked
    const lockRes = await supabaseRest(
      `message_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.queued&locked_at=is.null`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ locked_at: now, locked_by: LOCK_ID, status: 'processing' }),
      },
    );
    if (!lockRes.ok) { summary.skipped++; continue; }

    const text = campaign.message_template
      .replace(/\{\{company_name\}\}/gi, lead.company_name)
      .replace(/\{\{nome_empresa\}\}/gi, lead.company_name);

    const result = await sendWhatsAppText(lead.phone_e164, text);
    const attemptedAt = new Date().toISOString();

    await supabaseRest('message_attempts', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{
        message_job_id: job.id,
        provider_message_id: result.ok ? (result.providerMessageId || null) : null,
        outcome: result.ok ? 'accepted' : 'failed',
        error_code: result.ok ? null : (result.errorCode ?? null),
        error_message: result.ok ? null : result.errorMessage,
        attempted_at: attemptedAt,
      }]),
    });

    const jobPatch = result.ok
      ? { status: 'sent', locked_at: null, locked_by: null }
      : { status: 'failed', last_error: result.errorMessage.slice(0, 500), locked_at: null, locked_by: null };

    await supabaseRest(`message_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(jobPatch),
    });

    if (result.ok) {
      await Promise.all([
        supabaseRest(`campaign_recipients?id=eq.${encodeURIComponent(cr.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'sent' }),
        }),
        supabaseRest(`leads?id=eq.${encodeURIComponent(lead.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_contacted_at: attemptedAt, status: 'contacted' }),
        }),
      ]);
      summary.sent++;
    } else {
      summary.failed++;
      console.error(`[dispatcher:${objective}] send failed — ${lead.phone_e164}: ${result.errorMessage}`);
    }
  }

  return summary;
}

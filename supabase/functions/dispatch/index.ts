import { createClient } from 'jsr:@supabase/supabase-js@2'

const BATCH_SIZE = 15

type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode?: string; errorMessage: string }

async function sendWhatsAppText(phoneE164: string, text: string): Promise<SendResult> {
  const baseUrl = Deno.env.get('MESSAGE_PROVIDER_URL')
  const apiKey = Deno.env.get('MESSAGE_PROVIDER_API_KEY')
  const instance = Deno.env.get('MESSAGE_PROVIDER_INSTANCE')

  if (!baseUrl || !apiKey || !instance) {
    return { ok: false, errorCode: 'NOT_CONFIGURED', errorMessage: 'MESSAGE_PROVIDER env vars not set' }
  }

  const number = `${phoneE164.replace(/^\+/, '')}@s.whatsapp.net`
  const url = `${baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instance)}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number, text }),
      signal: AbortSignal.timeout(15_000),
    })
    const raw = await response.text().catch(() => '')
    if (!response.ok) {
      return { ok: false, errorCode: String(response.status), errorMessage: raw.slice(0, 500) || `HTTP ${response.status}` }
    }
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(raw) } catch { /* not JSON */ }
    const keyId = (data?.key as Record<string, unknown> | undefined)?.id
    const msgId =
      typeof keyId === 'string' ? keyId :
      typeof data?.messageId === 'string' ? (data.messageId as string) :
      typeof data?.id === 'string' ? (data.id as string) : ''
    return { ok: true, providerMessageId: msgId }
  } catch (err) {
    return {
      ok: false,
      errorCode: 'NETWORK_ERROR',
      errorMessage: err instanceof Error ? err.message : 'Network failure',
    }
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const objective = parseInt(url.searchParams.get('objective') ?? '', 10)

  if (!Number.isFinite(objective) || objective < 1 || objective > 10) {
    return Response.json({ error: 'objective must be integer 1-10' }, { status: 400 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const now = new Date().toISOString()
  const lockId = 'edge-dispatch'

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayStartISO = todayStart.toISOString()

  async function rest(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers as HeadersInit | undefined)
    headers.set('apikey', serviceRoleKey)
    headers.set('Authorization', `Bearer ${serviceRoleKey}`)
    headers.set('Content-Type', 'application/json')
    return fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers })
  }

  const summary = { objective, fetched: 0, sent: 0, failed: 0, skipped: 0 }

  const crFields = [
    'id', 'campaign_id', 'lead_id',
    'campaigns!inner(id,message_template,daily_limit,min_interval_seconds,status)',
    'leads!inner(id,phone_e164,company_name,status)',
  ].join(',')
  const select = `id,idempotency_key,campaign_recipient_id,campaign_recipients!inner(${crFields})`

  const qp = new URLSearchParams({
    select,
    status: 'eq.queued',
    run_after: `lte.${now}`,
    locked_at: 'is.null',
    order: 'run_after.asc',
    limit: String(BATCH_SIZE),
  })

  const jobsRes = await rest(`message_jobs?${qp}`)
  if (!jobsRes.ok) {
    return Response.json({ success: false, error: `DB fetch failed HTTP ${jobsRes.status}` }, { status: 500 })
  }

  const jobs = await jobsRes.json().catch(() => null)
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return Response.json({ success: true, ...summary })
  }
  summary.fetched = jobs.length

  // Pre-fetch daily sent counts for campaigns with daily_limit > 0
  const limitedCampaigns = new Map<string, number>()
  for (const job of jobs) {
    const c = job.campaign_recipients?.campaigns
    if (c && c.daily_limit > 0 && !limitedCampaigns.has(c.id)) limitedCampaigns.set(c.id, c.daily_limit)
  }

  const dailySent = new Map<string, number>()
  await Promise.all(Array.from(limitedCampaigns.keys()).map(async (cid) => {
    const cp = new URLSearchParams({
      select: 'id,message_jobs!inner(campaign_recipients!inner(campaign_id))',
      'message_jobs.campaign_recipients.campaign_id': `eq.${cid}`,
      outcome: 'eq.accepted',
      attempted_at: `gte.${todayStartISO}`,
      limit: '0',
    })
    const r = await rest(`message_attempts?${cp}`, { headers: { Prefer: 'count=exact' } })
    const cr = r.headers.get('content-range') ?? ''
    const m = cr.match(/\/(\d+)$/)
    dailySent.set(cid, m ? parseInt(m[1], 10) : 0)
  }))

  for (const job of jobs) {
    const cr = job.campaign_recipients
    const campaign = cr?.campaigns
    const lead = cr?.leads

    if (!cr || !campaign || !lead) { summary.skipped++; continue }
    if (campaign.status !== 'running') { summary.skipped++; continue }
    if (lead.status !== 'eligible') { summary.skipped++; continue }

    if (campaign.daily_limit > 0) {
      const sentToday = dailySent.get(campaign.id) ?? 0
      if (sentToday >= campaign.daily_limit) { summary.skipped++; continue }
      dailySent.set(campaign.id, sentToday + 1)
    }

    const lockRes = await rest(
      `message_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.queued&locked_at=is.null`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ locked_at: now, locked_by: lockId, status: 'processing' }),
      },
    )
    if (!lockRes.ok) { summary.skipped++; continue }

    const text = campaign.message_template
      .replace(/\{\{company_name\}\}/gi, lead.company_name)
      .replace(/\{\{nome_empresa\}\}/gi, lead.company_name)

    const result = await sendWhatsAppText(lead.phone_e164, text)
    const attemptedAt = new Date().toISOString()

    await rest('message_attempts', {
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
    })

    const patch = result.ok
      ? { status: 'sent', locked_at: null, locked_by: null }
      : { status: 'failed', last_error: result.errorMessage.slice(0, 500), locked_at: null, locked_by: null }

    await rest(`message_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })

    if (result.ok) {
      await Promise.all([
        rest(`campaign_recipients?id=eq.${encodeURIComponent(cr.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'sent' }),
        }),
        rest(`leads?id=eq.${encodeURIComponent(lead.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_contacted_at: attemptedAt, status: 'contacted' }),
        }),
      ])
      summary.sent++
    } else {
      summary.failed++
      console.error(`[dispatch:${objective}] ${lead.phone_e164}: ${result.errorMessage}`)
    }
  }

  return Response.json({ success: true, ...summary })
})

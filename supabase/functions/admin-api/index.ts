// Admin API edge function — validates ADMIN_API_TOKEN stored in Supabase vault.
// Routes: GET|POST /campaigns, GET /campaigns/:id, PATCH /campaigns/:id,
//         POST /campaigns/:id/launch

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SERVICE_ACTOR = '00000000-0000-0000-0000-000000000001'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHUNK = 50

async function rest(path: string, init: RequestInit = {}) {
  const h = new Headers(init.headers as HeadersInit | undefined)
  h.set('apikey', SERVICE_ROLE_KEY)
  h.set('Authorization', `Bearer ${SERVICE_ROLE_KEY}`)
  h.set('Content-Type', 'application/json')
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: h })
}

async function getAdminToken(): Promise<string | null> {
  const res = await rest('rpc/get_vault_secret', {
    method: 'POST',
    body: JSON.stringify({ secret_name: 'ADMIN_API_TOKEN' }),
  })
  if (!res.ok) return null
  const text = await res.text().catch(() => null)
  if (!text) return null
  try { return JSON.parse(text) as string } catch { return text.replace(/^"|"$/g, '') }
}

async function jsonOrNull<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null)
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  }

  const adminToken = await getAdminToken()
  if (!adminToken || req.headers.get('Authorization') !== `Bearer ${adminToken}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const fnIdx = parts.findIndex((p) => p === 'admin-api')
  const segments = fnIdx >= 0 ? parts.slice(fnIdx + 1) : []

  const resource = segments[0]
  const resourceId = segments[1]
  const subResource = segments[2]

  if (resource !== 'campaigns') return json({ error: 'Not found' }, 404)

  // ── GET /campaigns ─────────────────────────────────────────────────────────
  if (!resourceId && req.method === 'GET') {
    const qp = new URLSearchParams({
      select: 'id,name,status,daily_limit,min_interval_seconds,scheduled_at,started_at,completed_at,created_at',
      order: 'created_at.desc',
      limit: '50',
    })
    const status = url.searchParams.get('status')
    if (status) qp.set('status', `eq.${status}`)
    const res = await rest(`campaigns?${qp}`)
    const body = await res.text()
    if (!res.ok) return json({ error: 'Unable to load campaigns' }, 502)
    return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }

  // ── POST /campaigns ────────────────────────────────────────────────────────
  if (!resourceId && req.method === 'POST') {
    const body = await req.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const template = typeof body?.messageTemplate === 'string' ? body.messageTemplate.trim() : ''
    const dailyLimit = typeof body?.dailyLimit === 'number' ? Math.min(Math.max(Math.floor(body.dailyLimit), 0), 100) : 0
    const minInterval = typeof body?.minIntervalSeconds === 'number' ? Math.max(Math.floor(body.minIntervalSeconds), 60) : 60
    const scheduledAt = typeof body?.scheduledAt === 'string' ? body.scheduledAt : null

    if (name.length < 2 || name.length > 140) return json({ error: 'name must be 2–140 chars' }, 400)
    if (template.length < 1 || template.length > 4096) return json({ error: 'messageTemplate must be 1–4096 chars' }, 400)

    const res = await rest('campaigns', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ name, message_template: template, daily_limit: dailyLimit, min_interval_seconds: minInterval, scheduled_at: scheduledAt, created_by: SERVICE_ACTOR }]),
    })
    const data = await jsonOrNull<unknown[]>(res)
    if (!res.ok) return json({ error: 'Unable to create campaign' }, 502)
    return json(Array.isArray(data) ? data[0] : data, 201)
  }

  // ── GET /campaigns/:id ─────────────────────────────────────────────────────
  if (resourceId && !subResource && req.method === 'GET') {
    if (!UUID_RE.test(resourceId)) return json({ error: 'Invalid id' }, 400)
    const res = await rest(`campaigns?id=eq.${resourceId}&select=id,name,message_template,status,daily_limit,min_interval_seconds,scheduled_at,started_at,completed_at,created_at`)
    const data = await jsonOrNull<unknown[]>(res)
    if (!res.ok || !Array.isArray(data) || data.length === 0) return json({ error: 'Campaign not found' }, 404)
    return json(data[0])
  }

  // ── PATCH /campaigns/:id ───────────────────────────────────────────────────
  if (resourceId && !subResource && req.method === 'PATCH') {
    if (!UUID_RE.test(resourceId)) return json({ error: 'Invalid id' }, 400)
    const body = await req.json().catch(() => null)
    const patch: Record<string, unknown> = {}

    if (typeof body?.name === 'string') {
      const n = body.name.trim()
      if (n.length < 2 || n.length > 140) return json({ error: 'name must be 2–140 chars' }, 400)
      patch.name = n
    }
    if (typeof body?.messageTemplate === 'string') {
      const t = body.messageTemplate.trim()
      if (t.length < 1 || t.length > 4096) return json({ error: 'messageTemplate must be 1–4096 chars' }, 400)
      patch.message_template = t
    }
    if (typeof body?.status === 'string') {
      const allowed = ['draft', 'scheduled', 'paused', 'cancelled']
      if (!allowed.includes(body.status)) return json({ error: `status must be one of: ${allowed.join(', ')}` }, 400)
      patch.status = body.status
    }
    if (typeof body?.dailyLimit === 'number') patch.daily_limit = Math.min(Math.max(Math.floor(body.dailyLimit), 0), 100)
    if (typeof body?.minIntervalSeconds === 'number') patch.min_interval_seconds = Math.max(Math.floor(body.minIntervalSeconds), 60)
    if (typeof body?.scheduledAt === 'string') patch.scheduled_at = body.scheduledAt

    if (Object.keys(patch).length === 0) return json({ error: 'No patchable fields provided' }, 400)

    const res = await rest(`campaigns?id=eq.${resourceId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    const data = await jsonOrNull<unknown[]>(res)
    if (!res.ok) return json({ error: 'Unable to update campaign' }, 502)
    if (!Array.isArray(data) || data.length === 0) return json({ error: 'Not found' }, 404)
    return json(data[0])
  }

  // ── POST /campaigns/:id/launch ─────────────────────────────────────────────
  if (resourceId && subResource === 'launch' && req.method === 'POST') {
    if (!UUID_RE.test(resourceId)) return json({ error: 'Invalid id' }, 400)
    const campaignId = resourceId

    const campRes = await rest(`campaigns?id=eq.${campaignId}&select=id,status,min_interval_seconds,daily_limit`)
    const camps = await jsonOrNull<Array<Record<string, unknown>>>(campRes)
    if (!campRes.ok || !Array.isArray(camps) || camps.length === 0) return json({ error: 'Campaign not found' }, 404)
    const campaign = camps[0]
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return json({ error: `Cannot launch campaign with status '${campaign.status}'. Must be draft or scheduled.` }, 409)
    }

    const minIntervalMs = Math.max(Number(campaign.min_interval_seconds) || 60, 60) * 1000

    const leadsRes = await rest(`leads?status=eq.eligible&deleted_at=is.null&select=id&order=created_at.asc&limit=500`)
    const leads = await jsonOrNull<Array<{ id: string }>>(leadsRes)
    if (!leadsRes.ok || !Array.isArray(leads)) return json({ error: 'Unable to load leads' }, 502)
    if (leads.length === 0) return json({ error: 'No eligible leads found' }, 422)

    const enrolledRes = await rest(`campaign_recipients?campaign_id=eq.${campaignId}&select=lead_id`)
    const enrolled = await jsonOrNull<Array<{ lead_id: string }>>(enrolledRes)
    const enrolledSet = new Set((enrolled ?? []).map((r) => r.lead_id))
    const newLeads = leads.filter((l) => !enrolledSet.has(l.id))

    if (newLeads.length === 0) {
      await rest(`campaigns?id=eq.${campaignId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }) })
      return json({ success: true, enrolledCount: 0, jobsCreated: 0, message: 'All leads already enrolled; campaign set to running.' })
    }

    const recipientRows = newLeads.map((l) => ({ campaign_id: campaignId, lead_id: l.id, status: 'queued' }))
    const insertedIds: string[] = []
    for (let i = 0; i < recipientRows.length; i += CHUNK) {
      const chunk = recipientRows.slice(i, i + CHUNK)
      const res = await rest('campaign_recipients?on_conflict=campaign_id,lead_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(chunk),
      })
      const inserted = await jsonOrNull<Array<{ id: string }>>(res)
      if (!res.ok) return json({ error: 'Failed to enroll recipients' }, 502)
      for (const r of inserted ?? []) insertedIds.push(r.id)
    }

    if (insertedIds.length === 0) {
      await rest(`campaigns?id=eq.${campaignId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }) })
      return json({ success: true, enrolledCount: 0, jobsCreated: 0, message: 'No new recipients; campaign set to running.' })
    }

    const baseTime = Date.now()
    const jobRows = insertedIds.map((recipientId, index) => ({
      campaign_recipient_id: recipientId,
      run_after: new Date(baseTime + index * minIntervalMs).toISOString(),
      status: 'queued',
    }))

    let jobsCreated = 0
    for (let i = 0; i < jobRows.length; i += CHUNK) {
      const chunk = jobRows.slice(i, i + CHUNK)
      const res = await rest('message_jobs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(chunk) })
      if (!res.ok) return json({ error: 'Failed to enqueue jobs', enrolledCount: insertedIds.length, jobsCreated }, 502)
      jobsCreated += chunk.length
    }

    await rest(`campaigns?id=eq.${campaignId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }) })

    const lastJobTime = new Date(baseTime + (jobRows.length - 1) * minIntervalMs)
    return json({ success: true, campaignId, enrolledCount: insertedIds.length, jobsCreated, firstJobAt: new Date(baseTime).toISOString(), lastJobAt: lastJobTime.toISOString() }, 201)
  }

  return json({ error: 'Method not allowed' }, 405)
})

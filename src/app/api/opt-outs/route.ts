import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApiToken, supabaseRest } from '@/lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

const e164 = /^\+[1-9]\d{7,14}$/;

export async function POST(request: NextRequest) {
  if (!requireAdminApiToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const phone = typeof body?.phoneE164 === 'string' ? body.phoneE164.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

  if (!e164.test(phone)) {
    return NextResponse.json({ error: 'phoneE164 must be E.164' }, { status: 400 });
  }

  const optOut = await supabaseRest('opt_outs?on_conflict=phone_e164', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ phone_e164: phone, channel: 'whatsapp', reason, source: 'admin_api' }]),
  });

  if (!optOut.ok) {
    return NextResponse.json({ error: 'Unable to register opt-out' }, { status: 502 });
  }

  const updateLead = await supabaseRest(`leads?phone_e164=eq.${encodeURIComponent(phone)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'opted_out', opted_out_at: new Date().toISOString() }),
  });

  if (!updateLead.ok) {
    return NextResponse.json({ error: 'Opt-out stored; lead status update failed' }, { status: 502 });
  }

  return NextResponse.json({ success: true, phoneE164: phone });
}

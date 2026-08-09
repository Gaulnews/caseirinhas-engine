import { NextRequest, NextResponse } from 'next/server';
import { supabaseRest } from '../../../../lib/server/supabase-rest';
import { applyOptOut, detectOptOutKeyword, isValidE164 } from '../../../../lib/server/opt-out';

export const dynamic = 'force-dynamic';

function requireWebhookSecret(request: NextRequest): boolean {
  const expected = process.env.MESSAGE_PROVIDER_WEBHOOK_SECRET;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

/**
 * Receives inbound messages from whatever messaging provider is eventually wired up
 * (see lib/server/messaging/provider.ts — no provider is configured today, so nothing calls
 * this in production yet; it exists so the opt-out flow has a concrete landing point to test
 * against). Auth is a shared secret, not ADMIN_API_TOKEN or a Supabase session, because the
 * caller here is a third-party server, not a staff member or the panel.
 */
export async function POST(request: NextRequest) {
  if (!requireWebhookSecret(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const providerMessageId = typeof body?.providerMessageId === 'string' ? body.providerMessageId.slice(0, 255) : null;
  const phoneE164 = typeof body?.phoneE164 === 'string' ? body.phoneE164.trim() : '';
  const messageText = typeof body?.messageText === 'string' ? body.messageText.slice(0, 4096) : '';
  const receivedAt = typeof body?.receivedAt === 'string' ? body.receivedAt : new Date().toISOString();

  if (!providerMessageId || !isValidE164(phoneE164) || !messageText) {
    return NextResponse.json({ error: 'providerMessageId, phoneE164 (E.164), and messageText are required' }, { status: 400 });
  }

  const insert = await supabaseRest('inbound_messages?on_conflict=provider_message_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify([{ provider_message_id: providerMessageId, phone_e164: phoneE164, message_text: messageText, received_at: receivedAt, raw_payload: body }]),
  });
  const inserted = await insert.json().catch(() => null);
  if (!insert.ok) return NextResponse.json({ error: 'Unable to store inbound message' }, { status: 502 });
  const isNewMessage = Array.isArray(inserted) && inserted.length > 0; // ignore-duplicates returns [] on a repeat delivery

  let optOutTriggered = false;
  if (isNewMessage) {
    const keyword = detectOptOutKeyword(messageText);
    if (keyword) {
      const result = await applyOptOut(phoneE164, `keyword:${keyword}`, 'inbound_webhook');
      optOutTriggered = result.ok;
    }
  }

  return NextResponse.json({ success: true, stored: isNewMessage, optOutTriggered });
}
